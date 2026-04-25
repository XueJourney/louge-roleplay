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
 */

const { query } = require('../lib/db');
const { redisClient } = require('../lib/redis');
const logger = require('../lib/logger');

const MESSAGE_TREE_CACHE_TTL_SECONDS = 60;

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
     WHERE conversation_id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}
     ORDER BY sequence_no ASC, id ASC`,
    [conversationId],
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

function stripThinkTags(value) {
  return String(value || '')
    .replace(/<\s*(think|thinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shortText(value, limit = 40) {
  return stripThinkTags(value).replace(/\s+/g, ' ').trim().slice(0, limit);
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

function buildTreeEntries(allMessages, activeIds, childrenMap) {
  const roots = allMessages
    .filter((message) => !message.parent_message_id)
    .sort((a, b) => {
      if (a.sequence_no !== b.sequence_no) {
        return Number(a.sequence_no) - Number(b.sequence_no);
      }
      return Number(a.id) - Number(b.id);
    });

  const entries = [];
  const visited = new Set();

  function walk(message, depth) {
    const messageId = Number(message.id);
    if (!messageId || visited.has(messageId)) {
      return false;
    }
    visited.add(messageId);

    const children = childrenMap.get(messageId) || [];
    const entry = {
      id: message.id,
      parentId: message.parent_message_id || null,
      depth,
      senderType: message.sender_type,
      promptKind: message.prompt_kind || 'normal',
      shortContent: shortText(message.content, 52),
      isActive: activeIds.has(messageId),
      isOnActiveTrail: false,
      childCount: children.length,
    };
    entries.push(entry);

    let subtreeHasActive = entry.isActive;
    for (const child of children) {
      if (walk(child, depth + 1)) {
        subtreeHasActive = true;
      }
    }
    entry.isOnActiveTrail = subtreeHasActive;
    return subtreeHasActive;
  }

  roots.forEach((root) => walk(root, 0));
  return entries;
}

function buildBranchDescriptor(allMessages, leaf, normalizedLeafId, childrenMap) {
  const branchPath = buildPathMessages(allMessages, leaf.id);
  const divergenceNode = branchPath.find((message) => {
    const parentId = message.parent_message_id ? Number(message.parent_message_id) : null;
    if (!parentId) {
      return false;
    }
    return (childrenMap.get(parentId) || []).length > 1;
  }) || branchPath[0] || leaf;

  const lastUser = [...branchPath].reverse().find((item) => item.sender_type === 'user');
  const lastAi = [...branchPath].reverse().find((item) => item.sender_type === 'character');
  const labelParts = [];

  if (divergenceNode) {
    labelParts.push(`从 #${divergenceNode.id} 分出`);
  }
  if (lastUser) {
    labelParts.push(`你：${shortText(lastUser.content, 14)}`);
  } else if (lastAi) {
    labelParts.push(`AI：${shortText(lastAi.content, 14)}`);
  }

  const summary = branchPath
    .slice(-4)
    .map((item) => `${item.sender_type === 'user' ? '你' : 'AI'}：${shortText(item.content, 18)}`)
    .join(' · ');

  return {
    leafId: leaf.id,
    isActive: Number(leaf.id) === normalizedLeafId,
    depth: branchPath.length,
    preview: branchPath
      .slice(-3)
      .map((item) => `${item.sender_type === 'user' ? '你' : 'AI'}：${shortText(item.content, 24)}`)
      .join(' · '),
    senderType: leaf.sender_type,
    promptKind: leaf.prompt_kind,
    label: labelParts.join(' · ') || `分支 #${leaf.id}`,
    summary: summary || '（空分支）',
    divergenceMessageId: divergenceNode ? divergenceNode.id : leaf.id,
  };
}

function buildConversationView(allMessages, activeLeafId) {
  const normalizedLeafId = activeLeafId ? Number(activeLeafId) : null;
  const { byId, childrenMap } = buildMessageMaps(allMessages);
  const path = buildPathMessages(allMessages, normalizedLeafId);
  const activeIds = new Set(path.map((message) => Number(message.id)));

  const pathMessages = path.map((message, index) => {
    const parentId = message.parent_message_id ? Number(message.parent_message_id) : null;
    const parentMessage = parentId ? byId.get(parentId) || null : null;
    const siblingVariants = parentId && childrenMap.has(parentId)
      ? childrenMap.get(parentId).map((item) => ({
          id: item.id,
          sender_type: item.sender_type,
          prompt_kind: item.prompt_kind,
          short_content: shortText(item.content, 40),
          is_active: Number(item.id) === Number(message.id),
        }))
      : [];

    const directChildren = childrenMap.get(Number(message.id)) || [];
    const nextChoices = directChildren.map((item) => ({
      id: item.id,
      sender_type: item.sender_type,
      prompt_kind: item.prompt_kind,
      short_content: shortText(item.content, 40),
      is_active: activeIds.has(Number(item.id)),
    }));

    return {
      ...message,
      depth: index,
      visibleContent: stripThinkTags(message.content),
      parentUserPreviewContent: parentMessage && parentMessage.sender_type === 'user' ? parentMessage.content : '',
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

  const branches = leafMessages.map((leaf) => buildBranchDescriptor(allMessages, leaf, normalizedLeafId, childrenMap));
  const currentBranch = branches.find((branch) => branch.isActive) || null;
  const treeEntries = buildTreeEntries(allMessages, activeIds, childrenMap);

  return {
    pathMessages,
    branches,
    treeEntries,
    currentBranch,
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
  addMessage,
  setConversationCurrentMessage,
  createEditedMessageVariant,
  buildPathMessages,
  buildConversationView,
  cloneConversationBranch,
  countChildConversations,
  deleteMessageSafely,
  deleteConversationSafely,
  invalidateConversationCache,
};
