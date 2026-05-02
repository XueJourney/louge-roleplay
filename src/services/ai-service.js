/**
 * @file src/services/ai-service.js
 * @description AI 回复生成服务。优先调用兼容 OpenAI 的接口，未配置时返回本地 fallback 文本。
 */

const config = require('../config');
const logger = require('../lib/logger');
const { applyRuntimeTemplateToCharacter, formatRuntimeTime } = require('./prompt-engineering-service');

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

function shouldAppendUserMessage(messages = [], userMessage = '') {
  const normalizedUserMessage = stripThinkTags(userMessage);
  if (!normalizedUserMessage) {
    return false;
  }

  const lastMessage = Array.isArray(messages) && messages.length
    ? messages[messages.length - 1]
    : null;
  if (!lastMessage || (lastMessage.sender_type === 'user' ? 'user' : 'assistant') !== 'user') {
    return true;
  }

  return stripThinkTags(lastMessage.content) !== normalizedUserMessage;
}

function buildRuntimeContext({ user = null, now = new Date() } = {}) {
  const username = String(user?.username || user?.name || user?.user || '').trim() || '用户';
  return {
    user: username,
    username,
    replyLengthPreference: String(user?.reply_length_preference || user?.replyLengthPreference || 'medium').trim() || 'medium',
    now,
    timeZone: 'Asia/Hong_Kong',
    time: formatRuntimeTime(now, { timeZone: 'Asia/Hong_Kong' }),
  };
}

function buildPromptMessages({ character, messages, userMessage, systemHint = '', user = null }) {
  const runtimeContext = { ...buildRuntimeContext({ user }), characterName: character?.name, char: character?.name };
  const runtimeCharacter = applyRuntimeTemplateToCharacter(character, runtimeContext);

  const historyPromptMessages = messages.slice(-24)
    .map((message) => ({
      role: message.sender_type === 'user' ? 'user' : 'assistant',
      content: stripThinkTags(message.content),
    }))
    .filter((message) => message.content);
  const normalizedUserMessage = stripThinkTags(userMessage);

  return [
    {
      role: 'system',
      content: [
        `你现在正在进行角色扮演。角色名：${runtimeCharacter.name}`,
        `角色简介：${runtimeCharacter.summary || ''}`,
        `角色性格：${runtimeCharacter.personality || ''}`,
        '请始终以该角色身份自然回复，避免脱离角色。',
        systemHint || '',
      ].filter(Boolean).join('\n'),
    },
    ...historyPromptMessages,
    ...(shouldAppendUserMessage(messages, userMessage)
      ? [{ role: 'user', content: normalizedUserMessage }]
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

async function generateReply({ character, messages, userMessage, systemHint = '', user = null }) {
  if (!config.openaiBaseUrl || !config.openaiApiKey || !config.openaiModel) {
    const runtimeContext = buildRuntimeContext({ user });
    const runtimeCharacter = applyRuntimeTemplateToCharacter(character, runtimeContext);
    return `${runtimeCharacter.name} 看着你，轻声说：我听见你说“${String(userMessage || '').slice(0, 120)}”。现在还没接上正式 AI 接口，所以我先陪你把网站流程跑通。`;
  }

  const promptMessages = buildPromptMessages({ character, messages, userMessage, systemHint, user });
  return callProvider(promptMessages);
}

function buildOptimizePromptMessages(userInput) {
  return [
    {
      role: 'system',
      content: [
        '你是“用户输入润色器”，不是聊天角色，也不是回复生成器。',
        '只把用户即将发送给角色的话润色得更清楚、更自然。',
        '只能输出润色后的用户输入本身；不要解释、不要加标题、不要加引号。',
        '必须保持第一人称/第二人称关系、原意、情绪、语气和信息量。',
        '不要代替角色回复，不要写 AI/助手/角色会说的话。',
        '不要续写剧情，不要增加新的动作、事实、承诺或设定。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `原始用户输入：\n${String(userInput || '').trim()}`,
    },
  ];
}

async function optimizeUserInput({ character, messages, userInput, user = null }) {
  if (!config.openaiBaseUrl || !config.openaiApiKey || !config.openaiModel) {
    return String(userInput || '').trim();
  }

  return callProvider(buildOptimizePromptMessages(userInput));
}

module.exports = {
  generateReply,
  optimizeUserInput,
};
