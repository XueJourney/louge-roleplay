/**
 * @file src/services/llm-gateway-service.js
 * @description 统一 LLM 调用入口：套餐、优先级、并发控制、provider 配置、用量记录。
 */

const logger = require('../lib/logger');
const { getActiveSubscriptionForUser, assertUserQuotaAvailable } = require('./plan-service');
const { getActiveProvider, buildModelOptions } = require('./llm-provider-service');
const { createLlmJob, updateLlmJob, createUsageLog } = require('./llm-usage-service');
const { listPromptBlocks, buildCharacterPromptItems, composeSystemPrompt } = require('./prompt-engineering-service');

const MAX_GLOBAL_CONCURRENCY = 5;
const DEFAULT_MAX_CONTEXT_TOKENS = 81920;
const DEFAULT_TRIM_CONTEXT_TOKENS = 61440;
const THINK_TAG_PATTERN = /<\s*(think|thinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const STREAM_DONE_SENTINEL = '[DONE]';
let activeCount = 0;
const pendingQueue = [];

function estimateTokens(text) {
  const content = String(text || '');
  return Math.max(1, Math.ceil(content.length / 4));
}

function estimatePromptTokens(promptMessages) {
  return estimateTokens(JSON.stringify(promptMessages || []));
}

function normalizeMessageRole(message) {
  return message.sender_type === 'user' ? 'user' : 'assistant';
}

function normalizeTextContent(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object') {
          if (typeof item.text === 'string') {
            return item.text;
          }
          if (typeof item.content === 'string') {
            return item.content;
          }
          if (item.type === 'text' && typeof item?.text?.value === 'string') {
            return item.text.value;
          }
        }
        return '';
      })
      .filter(Boolean)
      .join('');
  }

  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') {
      return value.text;
    }
    if (typeof value.content === 'string') {
      return value.content;
    }
  }

  return typeof value === 'string' ? value : '';
}

function stripThinkTags(text) {
  return String(text || '')
    .replace(THINK_TAG_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractReasoningText(data) {
  const message = data?.choices?.[0]?.message || {};
  const candidates = [
    message.reasoning_content,
    message.reasoning,
    message.reasoning_text,
    data?.choices?.[0]?.reasoning_content,
    data?.choices?.[0]?.reasoning,
    data?.reasoning_content,
    data?.reasoning,
  ];

  for (const candidate of candidates) {
    const text = normalizeTextContent(candidate).trim();
    if (text) {
      return text;
    }
  }

  return '';
}

function extractMessageContent(data) {
  const message = data?.choices?.[0]?.message || {};
  const text = normalizeTextContent(message.content).trim();
  if (text) {
    return text;
  }

  return normalizeTextContent(data?.choices?.[0]?.text).trim();
}

function combineReplyContent(content, reasoning) {
  const normalizedContent = String(content || '').trim();
  const normalizedReasoning = String(reasoning || '').trim();

  if (normalizedReasoning && normalizedContent) {
    return `<think>\n${normalizedReasoning}\n</think>\n\n${normalizedContent}`;
  }
  if (normalizedReasoning) {
    return `<think>\n${normalizedReasoning}\n</think>`;
  }
  return normalizedContent;
}

function buildSummaryTranscript(messages = []) {
  return messages
    .map((message) => `${message.sender_type === 'user' ? 'user' : 'AI'}:${stripThinkTags(message.content)}`)
    .filter(Boolean)
    .join('\n');
}

function getProviderModelId(provider, modelMode = 'standard') {
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

function buildModelModeOptions(provider) {
  const availableModelIds = new Set((provider?.availableModels || []).map((item) => item.id));
  const buildOption = (mode, label, modelId) => ({
    mode,
    label,
    enabled: Boolean(modelId),
    hiddenModelId: modelId || '',
    displayName: (provider?.availableModels || []).find((item) => item.id === modelId)?.label || label,
    searchableText: ((provider?.availableModels || []).find((item) => item.id === modelId)?.searchText || `${label} ${modelId || ''}`).trim(),
    inDiscoveryList: modelId ? availableModelIds.has(modelId) : false,
  });

  return [
    buildOption('standard', '标准对话模型', getProviderModelId(provider, 'standard')),
    buildOption('jailbreak', '破限模型', getProviderModelId(provider, 'jailbreak')),
    buildOption('force_jailbreak', '强制破限模型', getProviderModelId(provider, 'force_jailbreak')),
  ].filter((item) => item.enabled);
}

function trimMessagesForContext(promptMessages = [], provider) {
  const safePromptMessages = Array.isArray(promptMessages) ? [...promptMessages] : [];
  const maxContextTokens = Math.max(1024, Number(provider?.max_context_tokens || DEFAULT_MAX_CONTEXT_TOKENS));
  const trimContextTokens = Math.max(1024, Math.min(maxContextTokens, Number(provider?.trim_context_tokens || DEFAULT_TRIM_CONTEXT_TOKENS)));

  if (estimatePromptTokens(safePromptMessages) <= maxContextTokens) {
    return {
      promptMessages: safePromptMessages,
      discardedMessages: [],
      summaryInserted: false,
      maxContextTokens,
      trimContextTokens,
    };
  }

  const systemMessages = safePromptMessages.filter((message) => message.role === 'system');
  const nonSystemMessages = safePromptMessages.filter((message) => message.role !== 'system');
  const discardedMessages = [];

  while (nonSystemMessages.length > 1 && estimatePromptTokens([...systemMessages, ...nonSystemMessages]) > trimContextTokens) {
    discardedMessages.push(nonSystemMessages.shift());
  }

  return {
    promptMessages: [...systemMessages, ...nonSystemMessages],
    discardedMessages,
    summaryInserted: false,
    maxContextTokens,
    trimContextTokens,
  };
}

async function summarizeDiscardedMessages(provider, discardedMessages = []) {
  if (!discardedMessages.length) {
    return '';
  }

  const transcript = buildSummaryTranscript(discardedMessages.map((message) => ({
    sender_type: message.role === 'user' ? 'user' : 'character',
    content: message.content,
  })));

  const compressionPrompt = [
    {
      role: 'system',
      content: '请压缩总结被舍弃的历史对话，保留人物关系、事件进展、关键约定、情绪状态与未完成事项。输出简洁中文摘要，不要解释。',
    },
    {
      role: 'user',
      content: `请总结对话\n${transcript}`,
    },
  ];

  const result = await callProvider(provider, compressionPrompt, 600, 'compression');
  return String(result.content || '').trim();
}

async function buildPromptMessages({ provider, character, messages, userMessage, systemHint = '' }) {
  const promptBlocks = await listPromptBlocks({ enabledOnly: true });
  const systemPrompt = composeSystemPrompt({
    promptBlocks: promptBlocks.map((item) => ({
      key: item.block_key,
      value: item.block_value,
      sortOrder: item.sort_order,
      isEnabled: item.is_enabled,
    })),
    characterPromptItems: buildCharacterPromptItems(character),
    systemHint,
  });

  const initialMessages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    ...messages.map((message) => ({
      role: normalizeMessageRole(message),
      content: stripThinkTags(message.content),
    })),
    ...(userMessage ? [{ role: 'user', content: stripThinkTags(userMessage) }] : []),
  ];

  const trimmed = trimMessagesForContext(initialMessages, provider);
  if (!trimmed.discardedMessages.length) {
    return trimmed;
  }

  const summary = await summarizeDiscardedMessages(provider, trimmed.discardedMessages);
  if (!summary) {
    return trimmed;
  }

  const mergedPromptMessages = [...trimmed.promptMessages];
  const insertionIndex = mergedPromptMessages.findIndex((item) => item.role !== 'system');
  const summaryMessage = {
    role: 'user',
    content: `user:请总结对话 AI:${summary}`,
  };

  if (insertionIndex === -1) {
    mergedPromptMessages.push(summaryMessage);
  } else {
    mergedPromptMessages.splice(insertionIndex, 0, summaryMessage);
  }

  return {
    ...trimmed,
    promptMessages: mergedPromptMessages,
    summaryInserted: true,
    summary,
  };
}


function enqueueWithPriority(task, priority) {
  return new Promise((resolve, reject) => {
    pendingQueue.push({ task, priority, resolve, reject, queuedAt: Date.now() });
    pendingQueue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.queuedAt - b.queuedAt;
    });
    drainQueue();
  });
}

function drainQueue() {
  while (activeCount < MAX_GLOBAL_CONCURRENCY && pendingQueue.length > 0) {
    const nextJob = pendingQueue.shift();
    activeCount += 1;

    Promise.resolve()
      .then(() => nextJob.task())
      .then((result) => nextJob.resolve(result))
      .catch((error) => nextJob.reject(error))
      .finally(() => {
        activeCount -= 1;
        drainQueue();
      });
  }
}

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

async function callProviderStream(provider, promptMessages, maxOutputTokens, modelMode = 'standard', hooks = {}) {
  const startedAt = Date.now();
  const modelId = getProviderModelId(provider, modelMode);
  const normalizedBaseUrl = String(provider.base_url || '').replace(/\/$/, '');
  const timeoutMs = Math.max(1000, Number(provider.timeout_ms || 60000));
  const controller = new AbortController();
  const externalSignal = hooks.signal;
  let cleanedUp = false;

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

  const onExternalAbort = externalSignal && typeof externalSignal.addEventListener === 'function'
    ? () => {
        if (!controller.signal.aborted) {
          controller.abort(new Error('PROVIDER_REQUEST_ABORTED'));
        }
      }
    : null;

  if (onExternalAbort) {
    if (externalSignal.aborted) {
      controller.abort(new Error('PROVIDER_REQUEST_ABORTED'));
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new Error('PROVIDER_REQUEST_TIMEOUT'));
    }
  }, timeoutMs);

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
      bodySnippet: text.slice(0, 300),
    });
    throw new Error(`AI provider error: ${response.status} ${text.slice(0, 300)}`);
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


async function executeLlmRequest({ requestId, userId, conversationId = null, character, messages, userMessage, systemHint = '', promptKind = 'chat', modelMode = 'standard' }) {
  const subscription = await getActiveSubscriptionForUser(userId);
  if (!subscription) {
    throw new Error('User plan is not configured');
  }

  const provider = await getActiveProvider();
  if (!provider) {
    const fallbackPromptMessages = [{ role: 'user', content: String(userMessage || '') }];
    return {
      content: `${character.name} 看着你，轻声说：我听见你说“${String(userMessage || '').slice(0, 120)}”。现在后台还没配置可用的 LLM provider，所以我先陪你把流程跑通。`,
      usage: {
        inputTokens: estimatePromptTokens(fallbackPromptMessages),
        outputTokens: estimateTokens(userMessage || ''),
        totalTokens: estimatePromptTokens(fallbackPromptMessages) + estimateTokens(userMessage || ''),
        totalCost: 0,
        latencyMs: 0,
      },
      provider: null,
      plan: subscription,
      modelMode,
      modelOptions: [],
    };
  }

  provider.availableModels = buildModelOptions((() => {
    try {
      return JSON.parse(provider.available_models_json || '[]');
    } catch (error) {
      return [];
    }
  })());

  const promptBuild = await buildPromptMessages({ provider, character, messages, userMessage, systemHint });
  const promptMessages = promptBuild.promptMessages;
  const estimatedTokens = estimatePromptTokens(promptMessages) + Number(subscription.max_output_tokens || 0);
  await assertUserQuotaAvailable(userId, estimatedTokens);

  const jobId = await createLlmJob({
    requestId,
    userId,
    conversationId,
    providerId: provider.id,
    priority: Number(subscription.priority_weight || 0),
    status: 'queued',
    promptKind,
  });

  return {
    subscription,
    provider,
    promptBuild,
    promptMessages,
    jobId,
  };
}

async function finalizeLlmJobSuccess({ jobId, startedAt, provider, subscription, requestId, userId, conversationId, promptKind, result, modelMode, promptBuild }) {
  const totalCost = (
    (Number(result.inputTokens || 0) / 1000) * Number(provider.input_token_price || 0)
    + (Number(result.outputTokens || 0) / 1000) * Number(provider.output_token_price || 0)
  );

  await updateLlmJob(jobId, {
    providerId: provider.id,
    status: 'success',
    startedAt,
    finishedAt: new Date(),
  });

  await createUsageLog({
    requestId,
    userId,
    conversationId,
    providerId: provider.id,
    planId: subscription.plan_id,
    promptKind,
    status: 'success',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens,
    totalCost,
    latencyMs: result.latencyMs,
  });

  return {
    content: result.content,
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      totalCost,
      latencyMs: result.latencyMs,
    },
    provider,
    plan: subscription,
    modelMode,
    modelOptions: buildModelModeOptions(provider),
    contextMeta: {
      maxContextTokens: promptBuild.maxContextTokens,
      trimContextTokens: promptBuild.trimContextTokens,
      summaryInserted: promptBuild.summaryInserted,
    },
  };
}

async function finalizeLlmJobFailure({ jobId, startedAt, provider, subscription, requestId, userId, conversationId, promptKind, error }) {
  logger.error('LLM gateway request failed', {
    requestId,
    userId,
    providerId: provider.id,
    error: error.message,
  });

  await updateLlmJob(jobId, {
    providerId: provider.id,
    status: 'failed',
    startedAt,
    finishedAt: new Date(),
    errorMessage: error.message,
  });

  await createUsageLog({
    requestId,
    userId,
    conversationId,
    providerId: provider.id,
    planId: subscription.plan_id,
    promptKind,
    status: 'failed',
    errorMessage: error.message,
  });
}

async function executeLlmQueued(requestMeta, runner) {
  const { subscription, provider, promptBuild, promptMessages, jobId } = await executeLlmRequest(requestMeta);
  return enqueueWithPriority(async () => {
    const startedAt = new Date();
    await updateLlmJob(jobId, {
      providerId: provider.id,
      status: 'running',
      startedAt,
    });

    try {
      const result = await runner({ provider, promptMessages, subscription, promptBuild });
      return await finalizeLlmJobSuccess({
        jobId,
        startedAt,
        provider,
        subscription,
        requestId: requestMeta.requestId,
        userId: requestMeta.userId,
        conversationId: requestMeta.conversationId,
        promptKind: requestMeta.promptKind,
        result,
        modelMode: requestMeta.modelMode,
        promptBuild,
      });
    } catch (error) {
      await finalizeLlmJobFailure({
        jobId,
        startedAt,
        provider,
        subscription,
        requestId: requestMeta.requestId,
        userId: requestMeta.userId,
        conversationId: requestMeta.conversationId,
        promptKind: requestMeta.promptKind,
        error,
      });
      throw error;
    }
  }, Number(subscription.priority_weight || 0));
}

async function generateReplyViaGateway({ requestId, userId, conversationId = null, character, messages, userMessage, systemHint = '', promptKind = 'chat', modelMode = 'standard', signal = null }) {
  const result = await executeLlmQueued(
    { requestId, userId, conversationId, character, messages, userMessage, systemHint, promptKind, modelMode },
    ({ provider, promptMessages, subscription }) => callProvider(provider, promptMessages, subscription.max_output_tokens || 0, modelMode, { signal }),
  );
  return result.content;
}

async function streamReplyViaGateway({ requestId, userId, conversationId = null, character, messages, userMessage, systemHint = '', promptKind = 'chat', modelMode = 'standard', onDelta = null, signal = null }) {
  return executeLlmQueued(
    { requestId, userId, conversationId, character, messages, userMessage, systemHint, promptKind, modelMode },
    ({ provider, promptMessages, subscription }) => callProviderStream(provider, promptMessages, subscription.max_output_tokens || 0, modelMode, { onDelta, signal }),
  );
}

async function streamOptimizeUserInputViaGateway({ requestId, userId, conversationId = null, character, messages, userInput, modelMode = 'standard', onDelta = null, signal = null }) {
  return executeLlmQueued(
    {
      requestId,
      userId,
      conversationId,
      character,
      messages,
      userMessage: `原始输入：\n${String(userInput || '').trim()}`,
      systemHint: '你要帮用户优化输入内容。输出只给优化后的用户输入，不要解释，不要加引号。',
      promptKind: 'optimize',
      modelMode,
    },
    ({ provider, promptMessages, subscription }) => callProviderStream(provider, promptMessages, subscription.max_output_tokens || 0, modelMode, { onDelta, signal }),
  );
}

async function optimizeUserInputViaGateway({ requestId, userId, conversationId = null, character, messages, userInput, modelMode = 'standard', signal = null }) {
  const result = await executeLlmQueued(
    {
      requestId,
      userId,
      conversationId,
      character,
      messages,
      userMessage: `原始输入：\n${String(userInput || '').trim()}`,
      systemHint: '你要帮用户优化输入内容。输出只给优化后的用户输入，不要解释，不要加引号。',
      promptKind: 'optimize',
      modelMode,
    },
    ({ provider, promptMessages, subscription }) => callProvider(provider, promptMessages, subscription.max_output_tokens || 0, modelMode, { signal }),
  );
  return result.content;
}


async function getChatModelSelector() {
  const provider = await getActiveProvider();
  if (!provider) {
    return {
      provider: null,
      options: [],
      maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
      trimContextTokens: DEFAULT_TRIM_CONTEXT_TOKENS,
    };
  }

  provider.availableModels = buildModelOptions((() => {
    try {
      return JSON.parse(provider.available_models_json || '[]');
    } catch (error) {
      return [];
    }
  })());

  return {
    provider,
    options: buildModelModeOptions(provider),
    maxContextTokens: Number(provider.max_context_tokens || DEFAULT_MAX_CONTEXT_TOKENS),
    trimContextTokens: Number(provider.trim_context_tokens || DEFAULT_TRIM_CONTEXT_TOKENS),
  };
}

module.exports = {
  MAX_GLOBAL_CONCURRENCY,
  generateReplyViaGateway,
  streamReplyViaGateway,
  streamOptimizeUserInputViaGateway,
  optimizeUserInputViaGateway,
  getChatModelSelector,
};
