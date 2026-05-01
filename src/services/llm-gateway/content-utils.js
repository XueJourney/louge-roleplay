/**
 * @file src/services/llm-gateway/content-utils.js
 * @description LLM 响应内容、token 粗估和上下文裁剪工具。
 */

const THINK_TAG_PATTERN = /<\s*(think|thinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const DEFAULT_MAX_CONTEXT_TOKENS = 81920;
const DEFAULT_TRIM_CONTEXT_TOKENS = 61440;

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
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          if (typeof item.text === 'string') return item.text;
          if (typeof item.content === 'string') return item.content;
          if (item.type === 'text' && typeof item?.text?.value === 'string') return item.text.value;
        }
        return '';
      })
      .filter(Boolean)
      .join('');
  }

  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
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
    if (text) return text;
  }

  return '';
}

function extractMessageContent(data) {
  const message = data?.choices?.[0]?.message || {};
  const text = normalizeTextContent(message.content).trim();
  if (text) return text;
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
  if (!normalizedUserMessage) return false;

  const lastMessage = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
  if (!lastMessage || normalizeMessageRole(lastMessage) !== 'user') return true;

  return stripThinkTags(lastMessage.content) !== normalizedUserMessage;
}

function buildSummaryTranscript(messages = []) {
  return messages
    .map((message) => `${message.sender_type === 'user' ? 'user' : 'AI'}:${stripThinkTags(message.content)}`)
    .filter(Boolean)
    .join('\n');
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

module.exports = {
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_TRIM_CONTEXT_TOKENS,
  estimateTokens,
  estimatePromptTokens,
  normalizeMessageRole,
  normalizeTextContent,
  stripThinkTags,
  extractReasoningText,
  extractMessageContent,
  combineReplyContent,
  shouldAppendUserMessage,
  buildSummaryTranscript,
  trimMessagesForContext,
};
