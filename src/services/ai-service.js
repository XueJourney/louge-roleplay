/**
 * @file src/services/ai-service.js
 * @description AI 回复生成服务。优先调用兼容 OpenAI 的接口，未配置时返回本地 fallback 文本。
 */

const config = require('../config');
const logger = require('../lib/logger');

const THINK_TAG_PATTERN = /<\s*(think|thinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const STREAM_DONE_SENTINEL = '[DONE]';

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

function buildPromptMessages({ character, messages, userMessage, systemHint = '' }) {
  return [
    {
      role: 'system',
      content: [
        `你现在正在进行角色扮演。角色名：${character.name}`,
        `角色简介：${character.summary || ''}`,
        `角色性格：${character.personality || ''}`,
        '请始终以该角色身份自然回复，避免脱离角色。',
        systemHint || '',
      ].filter(Boolean).join('\n'),
    },
    ...messages.slice(-24).map((message) => ({
      role: message.sender_type === 'user' ? 'user' : 'assistant',
      content: stripThinkTags(message.content),
    })),
    ...(userMessage
      ? [{ role: 'user', content: stripThinkTags(userMessage) }]
      : []),
  ];
}

function parseStreamDelta(data) {
  const choice = data?.choices?.[0] || {};
  const delta = choice.delta || choice.message || {};
  const contentCandidates = [delta.content, delta.text, choice.text, data?.text];
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

async function callProvider(promptMessages) {
  const baseUrl = String(config.openaiBaseUrl || '').replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutMs = 60000;
  const timeout = setTimeout(() => controller.abort(new Error('PROVIDER_REQUEST_TIMEOUT')), timeoutMs);
  let response;

  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: config.openaiModel,
        messages: promptMessages,
        temperature: 0.9,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.message === 'PROVIDER_REQUEST_TIMEOUT') {
      throw new Error(`AI provider request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    logger.error('AI provider request failed', { status: response.status, text });
    throw new Error(`AI provider error: ${response.status}`);
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const data = await response.json();
    const content = extractMessageContent(data).trim();
    const reasoning = extractReasoningText(data).trim();
    return combineReplyContent(content, reasoning) || '……';
  }

  if (!response.body) {
    throw new Error('AI provider stream body is empty');
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let fullContent = '';
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

  const handleSseBlock = (block) => {
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

      const { content, reasoning } = parseStreamDelta(data);
      if (reasoning) {
        fullContent += appendReasoningDelta(reasoning);
      }
      if (content) {
        fullContent += appendContentDelta(content);
      }
    }
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n+/);
    buffer = blocks.pop() || '';

    for (const block of blocks) {
      const shouldStop = handleSseBlock(block);
      if (shouldStop) {
        buffer = '';
        break;
      }
    }
  }

  if (buffer.trim()) {
    handleSseBlock(buffer);
  }

  fullContent += closeReasoningIfNeeded();
  return String(fullContent || '').trim() || '……';
}

async function generateReply({ character, messages, userMessage, systemHint = '' }) {
  if (!config.openaiBaseUrl || !config.openaiApiKey || !config.openaiModel) {
    return `${character.name} 看着你，轻声说：我听见你说“${String(userMessage || '').slice(0, 120)}”。现在还没接上正式 AI 接口，所以我先陪你把网站流程跑通。`;
  }

  const promptMessages = buildPromptMessages({ character, messages, userMessage, systemHint });
  return callProvider(promptMessages);
}

async function optimizeUserInput({ character, messages, userInput }) {
  if (!config.openaiBaseUrl || !config.openaiApiKey || !config.openaiModel) {
    return `请帮我把下面这段输入润色得更清楚、更自然，同时保留原意和情绪：\n\n${String(userInput || '').trim()}`;
  }

  const promptMessages = buildPromptMessages({
    character,
    messages,
    systemHint: '你要帮用户优化输入内容。输出只给优化后的用户输入，不要解释，不要加引号。',
    userMessage: `原始输入：\n${String(userInput || '').trim()}`,
  });
  return callProvider(promptMessages);
}

module.exports = {
  generateReply,
  optimizeUserInput,
};
