/**
 * @file src/services/conversation-service.js
 * @description
 * 会话与消息持久化服务。
 *
 * 目标：
 * 1. 使用 parent_message_id 保存消息之间的衔接关系。
 * 2. 支持重新生成、编辑后重发、从较早位置重写后续。
 * 3. 支持把某个位置之前的内容复制成独立对话。
 * 4. 聊天页优先读取当前显示链；完整消息列表只保留给独立对话复制/诊断脚本。
 */

const { query } = require('../lib/db');
const { redisClient } = require('../lib/redis');
const logger = require('../lib/logger');
const {
  buildPathMessages,
  decoratePathMessages,
} = require('./conversation/message-view');
const { fetchPathMessages } = require('./conversation/path-repository');

const MESSAGE_LIST_CACHE_TTL_SECONDS = 60;

const MESSAGE_PROMPT_KIND_VALUES = new Set([
  'normal',
  'regenerate',
  'branch',
  'edit',
  'optimized',
  'replay',
  'conversation-start',
  'first-message',
]);

function normalizeMessagePromptKind(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'chat') {
    return 'normal';
  }
  return MESSAGE_PROMPT_KIND_VALUES.has(raw) ? raw : 'normal';
}

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
      selected_model_mode,
      title,
      status,
      last_message_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'active', NOW(), NOW(), NOW())`,
    [
      userId,
      characterId,
      options.parentConversationId || null,
      options.branchedFromMessageId || null,
      options.selectedModelMode || 'standard',
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

async function updateConversationModelMode(conversationId, selectedModelMode) {
  await query(
    'UPDATE conversations SET selected_model_mode = ?, updated_at = NOW() WHERE id = ?',
    [String(selectedModelMode || 'standard').trim(), conversationId],
  );
}

async function getConversationById(id, userId) {
  const rows = await query(
    `SELECT c.*, ch.name AS character_name, ch.summary AS character_summary, ch.personality, ch.first_message, ch.prompt_profile_json
     FROM conversations c
     JOIN characters ch ON ch.id = c.character_id
     WHERE c.id = ? AND c.user_id = ? AND c.status <> 'deleted'
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
     WHERE c.user_id = ? AND c.status <> 'deleted'
     ORDER BY c.updated_at DESC, c.id DESC`,
    [userId],
  );
}

async function fetchMessagesFromDatabase(conversationId, options = {}) {
  const includeDeleted = options.includeDeleted === true;
  const extraWhere = options.extraWhere || '';
  const extraParams = Array.isArray(options.extraParams) ? options.extraParams : [];
  const orderAndLimit = options.orderAndLimit || ' ORDER BY sequence_no ASC, id ASC';

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
       metadata_json,
       deleted_at
     FROM messages
     WHERE conversation_id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}${extraWhere}${orderAndLimit}`,
    [conversationId, ...extraParams],
  );
}

async function listMessages(conversationId) {
  const cacheKey = getConversationMessagesCacheKey(conversationId);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      logger.debug('Conversation messages cache hit', {
        conversationId,
        cacheKey,
        count: Array.isArray(parsed) ? parsed.length : 0,
      });
      return parsed;
    }
    logger.debug('Conversation messages cache miss', { conversationId, cacheKey });
  } catch (error) {
    logger.warn('Failed to read conversation cache', {
      conversationId,
      cacheKey,
      error: error.message,
    });
  }

  const rows = await fetchMessagesFromDatabase(conversationId);
  logger.debug('Conversation messages loaded from database', {
    conversationId,
    count: rows.length,
  });

  try {
    await redisClient.setEx(cacheKey, MESSAGE_LIST_CACHE_TTL_SECONDS, JSON.stringify(rows));
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
  const rows = await fetchMessagesFromDatabase(conversationId, { extraWhere: ' AND id = ?', extraParams: [messageId] });
  return rows[0] || null;
}

async function getLatestMessage(conversationId) {
  const rows = await fetchMessagesFromDatabase(conversationId, { orderAndLimit: ' ORDER BY sequence_no DESC, id DESC LIMIT 1' });
  return rows[0] || null;
}

async function getConversationMessageCount(conversationId) {
  const rows = await query(
    'SELECT COUNT(*) AS messageCount FROM messages WHERE conversation_id = ? AND deleted_at IS NULL',
    [conversationId],
  );
  return Number(rows[0]?.messageCount || 0);
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
    ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
    [
      options.conversationId,
      options.senderType,
      options.content,
      nextSequence,
      options.status || 'success',
      options.parentMessageId || null,
      options.branchFromMessageId || null,
      options.editedFromMessageId || null,
      normalizeMessagePromptKind(options.promptKind),
      options.metadataJson || null,
    ],
  );

  await setConversationCurrentMessage(options.conversationId, result.insertId);
  await invalidateConversationCache(options.conversationId);
  logger.debug('Conversation message added', {
    conversationId: options.conversationId,
    messageId: result.insertId,
    senderType: options.senderType,
    status: options.status || 'success',
    parentMessageId: options.parentMessageId || null,
    promptKind: options.promptKind || 'normal',
    sequenceNo: nextSequence,
  });
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

  return addMessage({
    conversationId,
    senderType: sourceMessage.sender_type,
    content,
    parentMessageId: sourceMessage.parent_message_id || null,
    branchFromMessageId: sourceMessage.id,
    editedFromMessageId: sourceMessage.id,
    promptKind: 'edit',
    metadataJson: JSON.stringify({
      sourceMessageId: Number(sourceMessageId),
      editMode: 'fork-variant',
    }),
  });
}

async function buildConversationPathView(conversationId, activeLeafId, options = {}) {
  const normalizedLeafId = activeLeafId ? Number(activeLeafId) : null;
  const pathMessages = decoratePathMessages(await fetchPathMessages(conversationId, normalizedLeafId));
  const messageCount = options.messageCount === undefined
    ? await getConversationMessageCount(conversationId)
    : Number(options.messageCount || 0);

  return {
    pathMessages,
    activeLeafId: normalizedLeafId,
    messageCount,
  };
}

async function cloneConversationBranch(options) {
  const sourceMessages = await listMessages(options.sourceConversationId);
  const sourcePath = buildPathMessages(sourceMessages, options.sourceLeafMessageId);

  const newConversationId = await createConversation(options.userId, options.characterId, {
    parentConversationId: options.sourceConversationId,
    branchedFromMessageId: options.sourceLeafMessageId,
    selectedModelMode: options.selectedModelMode || 'standard',
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
      promptKind: sourceMessage.prompt_kind || 'normal',
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

async function countChildConversations(conversationId) {
  const rows = await query(
    "SELECT COUNT(*) AS childCount FROM conversations WHERE parent_conversation_id = ? AND deleted_at IS NULL",
    [conversationId],
  );
  return Number(rows[0]?.childCount || 0);
}

async function deleteMessageSafely(conversationId, messageId, userId) {
  const conversation = await getConversationById(conversationId, userId);
  if (!conversation) {
    const error = new Error('CONVERSATION_NOT_FOUND');
    error.code = 'CONVERSATION_NOT_FOUND';
    throw error;
  }

  const targetMessage = await getMessageById(conversationId, messageId);
  if (!targetMessage) {
    const error = new Error('MESSAGE_NOT_FOUND');
    error.code = 'MESSAGE_NOT_FOUND';
    throw error;
  }

  const childMessageRows = await query(
    "SELECT COUNT(*) AS childCount FROM messages WHERE conversation_id = ? AND parent_message_id = ? AND deleted_at IS NULL",
    [conversationId, messageId],
  );
  const childMessageCount = Number(childMessageRows[0]?.childCount || 0);
  if (childMessageCount > 0) {
    const error = new Error('MESSAGE_HAS_CHILDREN');
    error.code = 'MESSAGE_HAS_CHILDREN';
    error.childMessageCount = childMessageCount;
    throw error;
  }

  const branchedConversationRows = await query(
    "SELECT COUNT(*) AS branchConversationCount FROM conversations WHERE parent_conversation_id = ? AND branched_from_message_id = ? AND deleted_at IS NULL",
    [conversationId, messageId],
  );
  const branchConversationCount = Number(branchedConversationRows[0]?.branchConversationCount || 0);
  if (branchConversationCount > 0) {
    const error = new Error('MESSAGE_HAS_BRANCH_CONVERSATIONS');
    error.code = 'MESSAGE_HAS_BRANCH_CONVERSATIONS';
    error.branchConversationCount = branchConversationCount;
    throw error;
  }

  await query("UPDATE messages SET deleted_at = NOW() WHERE id = ? AND conversation_id = ?", [messageId, conversationId]);

  if (Number(conversation.current_message_id || 0) === Number(messageId)) {
    const fallbackMessageId = targetMessage.parent_message_id ? Number(targetMessage.parent_message_id) : null;
    await setConversationCurrentMessage(conversationId, fallbackMessageId);
  }

  await invalidateConversationCache(conversationId);

  return {
    deletedMessageId: Number(messageId),
    fallbackMessageId: targetMessage.parent_message_id ? Number(targetMessage.parent_message_id) : null,
  };
}

async function deleteConversationSafely(conversationId, userId) {
  const conversation = await getConversationById(conversationId, userId);
  if (!conversation) {
    const error = new Error('CONVERSATION_NOT_FOUND');
    error.code = 'CONVERSATION_NOT_FOUND';
    throw error;
  }

  await query("UPDATE conversations SET status = 'deleted', deleted_at = NOW(), updated_at = NOW() WHERE id = ? AND user_id = ?", [conversationId, userId]);
  await invalidateConversationCache(conversationId);
}

module.exports = {
  normalizeMessagePromptKind,
  createConversation,
  updateConversationTitle,
  updateConversationModelMode,
  getConversationById,
  listUserConversations,
  listMessages,
  getMessageById,
  getLatestMessage,
  getConversationMessageCount,
  addMessage,
  setConversationCurrentMessage,
  createEditedMessageVariant,
  buildPathMessages,
  fetchPathMessages,
  buildConversationPathView,
  cloneConversationBranch,
  countChildConversations,
  deleteMessageSafely,
  deleteConversationSafely,
  invalidateConversationCache,
};
