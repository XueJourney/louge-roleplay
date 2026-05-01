/**
 * @file src/services/conversation/message-view.js
 * @description 会话消息视图层纯函数：metadata 解析、think 标签清理和链路构建。
 */

function safeParseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function stripThinkTags(value) {
  return String(value || '')
    .replace(/<\s*(think|thinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shortText(value, limit = 40) {
  return stripThinkTags(value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeMessageForView(message) {
  if (!message) return null;
  return {
    ...message,
    metadata: safeParseJson(message.metadata_json),
  };
}

function buildMessageMaps(allMessages) {
  const byId = new Map();
  for (const message of allMessages) {
    byId.set(Number(message.id), normalizeMessageForView(message));
  }
  return { byId };
}

function buildPathMessages(allMessages, leafMessageId) {
  if (!leafMessageId) return [];

  const { byId } = buildMessageMaps(allMessages);
  const path = [];
  const visited = new Set();
  let currentId = Number(leafMessageId);

  while (currentId && byId.has(currentId) && !visited.has(currentId)) {
    visited.add(currentId);
    const current = byId.get(currentId);
    path.push(current);
    currentId = current.parent_message_id ? Number(current.parent_message_id) : 0;
  }

  return path.reverse();
}

function decoratePathMessages(pathMessages) {
  return pathMessages.map((message, index, messages) => {
    const parentMessage = index > 0 ? messages[index - 1] : null;
    const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;
    return {
      ...message,
      depth: index,
      visibleContent: stripThinkTags(message.content),
      parentUserPreviewContent: parentMessage && parentMessage.sender_type === 'user' ? parentMessage.content : '',
      hasVisibleContinuation: Boolean(nextMessage),
      siblingVariants: [],
      nextChoices: [],
      siblingCount: 0,
      childCount: 0,
    };
  });
}

module.exports = {
  safeParseJson,
  stripThinkTags,
  shortText,
  normalizeMessageForView,
  buildPathMessages,
  decoratePathMessages,
};
