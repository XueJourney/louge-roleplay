/**
 * @file src/services/conversation-service.js
 * @description
 * 会话与消息持久化服务。
 *
 * 目标：
 * 1. 支持树状消息结构（parent_message_id）。
 * 2. 支持重生成、编辑分支、任意节点继续对话。
 * 3. 支持从任意节点克隆出新会话分支。
 * 4. 使用 Redis 缓存整棵消息树，降低高频聊天页读取成本。
 *
 * 说明：
 * - 这里尽量把“结构性逻辑”集中在 service 层，避免路由层堆太多细节。
 * - 所有写操作都会主动失效 Redis 缓存，保证页面读到的是新树。
 */

const { query } = require('../lib/db');
const { redisClient } = require('../lib/redis');
const logger = require('../lib/logger');

const MESSAGE_TREE_CACHE_TTL_SECONDS = 60;

function getConversationMessagesCacheKey(conversationId) {
  return `conversation:${conversationId}:messages:v2`;
}

async function invalidateConversationCache(conversationId) {
  const cacheKey = getConversationMessagesCacheKey(conversationId);
  try {
    await redisClient.del(cacheKey);
  } catch (error) {
    logger.warn('Failed to invalidate conversation cache', {
      conversationId,
      cacheKey,
      error: error.message,
    });
  }
}

async function createConversation(userId, characterId, options = {}) {
  const result = await query(
    `INSERT INTO conversations (
      user_id,
      character_id,
      parent_conversation_id,
      branched_from_message_id,
      current_message_id,
      title,
      status,
      last_message_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, 'active', NOW(), NOW(), NOW())`,
    [
      userId,
      characterId,
      options.parentConversationId || null,
      options.branchedFromMessageId || null,
      options.title || '新对话',
    ],
  );
  return result.insertId;
}

async function updateConversationTitle(conversationId, title) {
  await query(
    'UPDATE conversations SET title = ?, updated_at = NOW() WHERE id = ?',
    [title, conversationId],
  );
}

async function getConversationById(id, userId) {
  const rows = await query(
    `SELECT c.*, ch.name AS character_name, ch.summary AS character_summary, ch.personality, ch.first_message
     FROM conversations c
     JOIN characters ch ON ch.id = c.character_id
     WHERE c.id = ? AND c.user_id = ?
     LIMIT 1`,
    [id, userId],
  );
  return rows[0] || null;
}

async function listUserConversations(userId) {
  return query(
    `SELECT
       c.id,
       c.title,
       c.updated_at,
       c.current_message_id,
       c.parent_conversation_id,
       c.branched_from_message_id,
       ch.name AS character_name
     FROM conversations c
     JOIN characters ch ON ch.id = c.character_id
     WHERE c.user_id = ?
     ORDER BY c.updated_at DESC, c.id DESC`,
    [userId],
  );
}

async function fetchMessagesFromDatabase(conversationId) {
  return query(
    `SELECT
       id,
       conversation_id,
       sender_type,
       content,
       sequence_no,
       status,
       created_at,
       parent_message_id,
       branch_from_message_id,
       edited_from_message_id,
       prompt_kind,
       metadata_json
     FROM messages
     WHERE conversation_id = ?
     ORDER BY sequence_no ASC, id ASC`,
    [conversationId],
  );
}

async function listMessages(conversationId) {
  const cacheKey = getConversationMessagesCacheKey(conversationId);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    logger.warn('Failed to read conversation cache', {
      conversationId,
      cacheKey,
      error: error.message,
    });
  }

  const rows = await fetchMessagesFromDatabase(conversationId);

  try {
    await redisClient.setEx(cacheKey, MESSAGE_TREE_CACHE_TTL_SECONDS, JSON.stringify(rows));
  } catch (error) {
    logger.warn('Failed to write conversation cache', {
      conversationId,
      cacheKey,
      error: error.message,
    });
  }

  return rows;
}

async function getMessageById(conversationId, messageId) {
  const allMessages = await listMessages(conversationId);
  return allMessages.find((message) => Number(message.id) === Number(messageId)) || null;
}

async function addMessage(options) {
  const seqRows = await query(
    'SELECT COALESCE(MAX(sequence_no), 0) AS maxSeq FROM messages WHERE conversation_id = ?',
    [options.conversationId],
  );
  const nextSequence = Number(seqRows[0].maxSeq || 0) + 1;

  const result = await query(
    `INSERT INTO messages (
      conversation_id,
      sender_type,
      content,
      sequence_no,
      status,
      created_at,
      parent_message_id,
      branch_from_message_id,
      edited_from_message_id,
      prompt_kind,
      metadata_json
    ) VALUES (?, ?, ?, ?, 'success', NOW(), ?, ?, ?, ?, ?)`,
    [
      options.conversationId,
      options.senderType,
      options.content,
      nextSequence,
      options.parentMessageId || null,
      options.branchFromMessageId || null,
      options.editedFromMessageId || null,
      options.promptKind || 'normal',
      options.metadataJson || null,
    ],
  );

  await setConversationCurrentMessage(options.conversationId, result.insertId);
  await invalidateConversationCache(options.conversationId);
  return result.insertId;
}

async function setConversationCurrentMessage(conversationId, messageId) {
  await query(
    `UPDATE conversations
     SET current_message_id = ?, updated_at = NOW(), last_message_at = NOW()
     WHERE id = ?`,
    [messageId || null, conversationId],
  );
}

async function createEditedMessageVariant(conversationId, sourceMessageId, content) {
  const sourceMessage = await getMessageById(conversationId, sourceMessageId);
  if (!sourceMessage) {
    return null;
  }

  const metadataJson = JSON.stringify({
    sourceMessageId: Number(sourceMessageId),
    editMode: 'fork-variant',
  });

  return addMessage({
    conversationId,
    senderType: sourceMessage.sender_type,
    content,
    parentMessageId: sourceMessage.parent_message_id || null,
    branchFromMessageId: sourceMessage.id,
    editedFromMessageId: sourceMessage.id,
    promptKind: 'edit',
    metadataJson,
  });
}

function safeParseJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function buildMessageMaps(allMessages) {
  const byId = new Map();
  const childrenMap = new Map();

  for (const message of allMessages) {
    const normalized = {
      ...message,
      metadata: safeParseJson(message.metadata_json),
    };
    byId.set(Number(message.id), normalized);

    if (message.parent_message_id) {
      const parentId = Number(message.parent_message_id);
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId).push(normalized);
    }
  }

  for (const [, children] of childrenMap) {
    children.sort((a, b) => {
      if (a.sequence_no !== b.sequence_no) {
        return Number(a.sequence_no) - Number(b.sequence_no);
      }
      return Number(a.id) - Number(b.id);
    });
  }

  return { byId, childrenMap };
}

function buildPathMessages(allMessages, leafMessageId) {
  if (!leafMessageId) {
    return [];
  }

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

function buildConversationView(allMessages, activeLeafId) {
  const normalizedLeafId = activeLeafId ? Number(activeLeafId) : null;
  const { byId, childrenMap } = buildMessageMaps(allMessages);
  const path = buildPathMessages(allMessages, normalizedLeafId);
  const activeIds = new Set(path.map((message) => Number(message.id)));

  const pathMessages = path.map((message, index) => {
    const parentId = message.parent_message_id ? Number(message.parent_message_id) : null;
    const siblingVariants = parentId && childrenMap.has(parentId)
      ? childrenMap.get(parentId).map((item) => ({
          id: item.id,
          sender_type: item.sender_type,
          prompt_kind: item.prompt_kind,
          short_content: String(item.content || '').replace(/\s+/g, ' ').slice(0, 40),
          is_active: Number(item.id) === Number(message.id),
        }))
      : [];

    const directChildren = childrenMap.get(Number(message.id)) || [];
    const nextChoices = directChildren.map((item) => ({
      id: item.id,
      sender_type: item.sender_type,
      prompt_kind: item.prompt_kind,
      short_content: String(item.content || '').replace(/\s+/g, ' ').slice(0, 40),
      is_active: activeIds.has(Number(item.id)),
    }));

    return {
      ...message,
      depth: index,
      siblingVariants,
      nextChoices,
      siblingCount: siblingVariants.length,
      childCount: nextChoices.length,
    };
  });

  const nonRootIds = new Set(
    allMessages
      .filter((message) => message.parent_message_id)
      .map((message) => Number(message.parent_message_id)),
  );

  const leafMessages = allMessages
    .filter((message) => !nonRootIds.has(Number(message.id)))
    .sort((a, b) => Number(b.id) - Number(a.id));

  const branches = leafMessages.map((leaf) => {
    const branchPath = buildPathMessages(allMessages, leaf.id);
    const preview = branchPath
      .slice(-3)
      .map((item) => `${item.sender_type === 'user' ? '你' : 'AI'}：${String(item.content || '').replace(/\s+/g, ' ').slice(0, 24)}`)
      .join(' · ');

    return {
      leafId: leaf.id,
      isActive: Number(leaf.id) === normalizedLeafId,
      depth: branchPath.length,
      preview,
      senderType: leaf.sender_type,
      promptKind: leaf.prompt_kind,
    };
  });

  return {
    pathMessages,
    branches,
    activeLeafId: normalizedLeafId,
    messageCount: allMessages.length,
  };
}

async function cloneConversationBranch(options) {
  const sourceMessages = await listMessages(options.sourceConversationId);
  const sourcePath = buildPathMessages(sourceMessages, options.sourceLeafMessageId);

  const newConversationId = await createConversation(options.userId, options.characterId, {
    parentConversationId: options.sourceConversationId,
    branchedFromMessageId: options.sourceLeafMessageId,
    title: options.title,
  });

  const idMap = new Map();
  let newLeafMessageId = null;

  for (const sourceMessage of sourcePath) {
    const clonedMessageId = await addMessage({
      conversationId: newConversationId,
      senderType: sourceMessage.sender_type,
      content: sourceMessage.content,
      parentMessageId: sourceMessage.parent_message_id ? idMap.get(Number(sourceMessage.parent_message_id)) || null : null,
      branchFromMessageId: sourceMessage.id,
      editedFromMessageId: sourceMessage.edited_from_message_id || null,
      promptKind: sourceMessage.prompt_kind === 'normal' ? 'branch' : sourceMessage.prompt_kind,
      metadataJson: JSON.stringify({
        clonedFromConversationId: Number(options.sourceConversationId),
        clonedFromMessageId: Number(sourceMessage.id),
      }),
    });

    idMap.set(Number(sourceMessage.id), clonedMessageId);
    newLeafMessageId = clonedMessageId;
  }

  return {
    conversationId: newConversationId,
    leafMessageId: newLeafMessageId,
  };
}

module.exports = {
  createConversation,
  updateConversationTitle,
  getConversationById,
  listUserConversations,
  listMessages,
  getMessageById,
  addMessage,
  setConversationCurrentMessage,
  createEditedMessageVariant,
  buildPathMessages,
  buildConversationView,
  cloneConversationBranch,
  invalidateConversationCache,
};
