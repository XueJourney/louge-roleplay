/**
 * @file src/services/llm-gateway/provider-client.js
 * @description OpenAI-compatible provider 调用与 SSE 流解析。
 */

const logger = require('../../lib/logger');
const {
  estimateTokens,
  estimatePromptTokens,
  normalizeTextContent,
  extractReasoningText,
  extractMessageContent,
  combineReplyContent,
} = require('./content-utils');

const STREAM_DONE_SENTINEL = '[DONE]';

function extractStreamDeltaParts(data) {
  const choice = data?.choices?.[0] || {};
  const delta = choice.delta || choice.message || {};
  const contentCandidates = [
    delta.content,
    delta.text,
    choice.text,
    data?.text,
  ];
  const reasoningCandidates = [
    delta.reasoning_content,
    delta.reasoning,
    delta.reasoning_text,
    choice.reasoning_content,
    choice.reasoning,
    data?.reasoning_content,
    data?.reasoning,
  ];

  let content = '';
  let reasoning = '';

  for (const candidate of contentCandidates) {
    const text = normalizeTextContent(candidate);
    if (text) {
      content = text;
      break;
    }
  }

  for (const candidate of reasoningCandidates) {
    const text = normalizeTextContent(candidate);
    if (text) {
      reasoning = text;
      break;
    }
  }

  return { content, reasoning };
}

function normalizeProviderError(error, timeoutMs = 60000) {
  const rawMessage = String(error?.message || error || '').trim();
  if (!rawMessage) {
    return new Error('AI provider request failed');
  }

  if (rawMessage === 'PROVIDER_REQUEST_ABORTED') {
    return new Error('AI provider request aborted by downstream client');
  }

  if (rawMessage === 'PROVIDER_REQUEST_TIMEOUT' || /timeout/i.test(rawMessage)) {
    return new Error(`AI provider request timeout after ${timeoutMs}ms`);
  }

  if (error?.name === 'AbortError') {
    return new Error(`AI provider request timeout after ${timeoutMs}ms`);
  }

  return error instanceof Error ? error : new Error(rawMessage);
}

async function readProviderErrorBody(response) {
  try {
    return await response.text();
  } catch (_) {
    return '';
  }
}

function getProviderModelId(provider, modelMode = 'standard') {
  if (provider?.selected_model_id) {
    return String(provider.selected_model_id || '').trim();
  }
  const normalizedMode = String(modelMode || 'standard').trim();
  if (normalizedMode === 'force_jailbreak') {
    return String(provider.force_jailbreak_model || provider.jailbreak_model || provider.standard_model || provider.model || '').trim();
  }
  if (normalizedMode === 'jailbreak') {
    return String(provider.jailbreak_model || provider.standard_model || provider.model || '').trim();
  }
  if (normalizedMode === 'compression') {
    return String(provider.compression_model || provider.standard_model || provider.model || '').trim();
  }
  return String(provider.standard_model || provider.model || '').trim();
}

async function callProviderStream(provider, promptMessages, maxOutputTokens, modelMode = 'standard', hooks = {}) {
  const startedAt = Date.now();
  const modelId = getProviderModelId(provider, modelMode);
  const normalizedBaseUrl = String(provider.base_url || '').replace(/\/$/, '');
  const timeoutMs = Math.max(1000, Number(provider.timeout_ms || 60000));
  const controller = new AbortController();
  const externalSignal = hooks.signal;
  let cleanedUp = false;
  let timeout = null;

  const armIdleTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(new Error('PROVIDER_REQUEST_TIMEOUT'));
      }
    }, timeoutMs);
  };

  const onExternalAbort = externalSignal && typeof externalSignal.addEventListener === 'function'
    ? () => {
        if (!controller.signal.aborted) {
          controller.abort(new Error('PROVIDER_REQUEST_ABORTED'));
        }
      }
    : null;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    clearTimeout(timeout);
    if (externalSignal && typeof externalSignal.removeEventListener === 'function' && onExternalAbort) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  };

  if (onExternalAbort) {
    if (externalSignal.aborted) {
      controller.abort(new Error('PROVIDER_REQUEST_ABORTED'));
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  armIdleTimeout();

  logger.info('LLM provider request start', {
    providerId: provider.id,
    providerType: provider.provider_type,
    modelMode,
    modelId,
    baseUrl: normalizedBaseUrl,
    timeoutMs,
    promptMessagesCount: Array.isArray(promptMessages) ? promptMessages.length : 0,
    maxOutputTokens: maxOutputTokens || 0,
    streaming: true,
  });

  let response;
  try {
    response = await fetch(`${normalizedBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.api_key}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: promptMessages,
        temperature: modelMode === 'compression' ? 0.2 : 0.9,
        max_tokens: maxOutputTokens || undefined,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
  } catch (error) {
    cleanup();
    throw normalizeProviderError(error, timeoutMs);
  }

  armIdleTimeout();

  logger.info('LLM provider response received', {
    providerId: provider.id,
    providerType: provider.provider_type,
    modelMode,
    status: response.status,
    contentType: String(response.headers.get('content-type') || '').toLowerCase(),
    elapsedMs: Date.now() - startedAt,
  });

  if (!response.ok) {
    const text = await readProviderErrorBody(response);
    cleanup();
    logger.error('LLM provider response error', {
      providerId: provider.id,
      providerType: provider.provider_type,
      modelMode,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
    });
    throw new Error(`AI provider error: ${response.status}`);
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const data = await response.json();
    cleanup();
    const content = extractMessageContent(data).trim();
    const reasoning = extractReasoningText(data).trim();
    const combinedContent = combineReplyContent(content, reasoning) || '……';
    const usage = data.usage || {};
    return {
      content: combinedContent,
      latencyMs: Date.now() - startedAt,
      inputTokens: Number(usage.prompt_tokens || estimatePromptTokens(promptMessages)),
      outputTokens: Number(usage.completion_tokens || estimateTokens(combinedContent)),
      totalTokens:
        Number(usage.total_tokens || 0)
        || (Number(usage.prompt_tokens || 0) + Number(usage.completion_tokens || 0))
        || (estimatePromptTokens(promptMessages) + estimateTokens(combinedContent)),
    };
  }

  if (!response.body) {
    cleanup();
    throw new Error('AI provider stream body is empty');
  }

  logger.info('LLM provider stream body ready', {
    providerId: provider.id,
    providerType: provider.provider_type,
    modelMode,
  });

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let fullContent = '';
  let usage = {};
  let reasoningOpen = false;

  const appendReasoningDelta = (text) => {
    const normalized = String(text || '');
    if (!normalized) {
      return '';
    }
    if (!reasoningOpen) {
      reasoningOpen = true;
      return `<think>\n${normalized}`;
    }
    return normalized;
  };

  const appendContentDelta = (text) => {
    const normalized = String(text || '');
    if (!normalized) {
      return '';
    }
    if (reasoningOpen) {
      reasoningOpen = false;
      return `\n</think>\n\n${normalized}`;
    }
    return normalized;
  };

  const closeReasoningIfNeeded = () => {
    if (!reasoningOpen) {
      return '';
    }
    reasoningOpen = false;
    return '\n</think>';
  };

  const handleSseBlock = async (block) => {
    const lines = String(block || '').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) {
        continue;
      }

      const payload = trimmed.slice(5).trim();
      if (!payload) {
        continue;
      }
      if (payload === STREAM_DONE_SENTINEL) {
        return true;
      }

      let data;
      try {
        data = JSON.parse(payload);
      } catch (_) {
        continue;
      }

      if (data?.usage && typeof data.usage === 'object') {
        usage = data.usage;
      }

      const { content, reasoning } = extractStreamDeltaParts(data);
      let deltaText = '';
      if (reasoning) {
        deltaText += appendReasoningDelta(reasoning);
      }
      if (content) {
        deltaText += appendContentDelta(content);
      }
      if (deltaText) {
        fullContent += deltaText;
        if (typeof hooks.onDelta === 'function') {
          await hooks.onDelta(deltaText, fullContent, data);
        }
      }
    }
    return false;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      armIdleTimeout();
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\n\n+/);
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        const shouldStop = await handleSseBlock(block);
        if (shouldStop) {
          buffer = '';
          break;
        }
      }
    }

    if (buffer.trim()) {
      await handleSseBlock(buffer);
    }
  } catch (error) {
    throw normalizeProviderError(error, timeoutMs);
  } finally {
    cleanup();
    try {
      reader.releaseLock();
    } catch (_) {}
  }

  fullContent += closeReasoningIfNeeded();

  const combinedContent = String(fullContent || '').trim() || '……';
  return {
    content: combinedContent,
    latencyMs: Date.now() - startedAt,
    inputTokens: Number(usage.prompt_tokens || estimatePromptTokens(promptMessages)),
    outputTokens: Number(usage.completion_tokens || estimateTokens(combinedContent)),
    totalTokens:
      Number(usage.total_tokens || 0)
      || (Number(usage.prompt_tokens || 0) + Number(usage.completion_tokens || 0))
      || (estimatePromptTokens(promptMessages) + estimateTokens(combinedContent)),
  };
}

async function callProvider(provider, promptMessages, maxOutputTokens, modelMode = 'standard', hooks = {}) {
  return callProviderStream(provider, promptMessages, maxOutputTokens, modelMode, hooks);
}

module.exports = {
  callProvider,
  callProviderStream,
  extractStreamDeltaParts,
  getProviderModelId,
  normalizeProviderError,
};
