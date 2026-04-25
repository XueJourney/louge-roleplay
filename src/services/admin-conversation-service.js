/**
 * @file src/services/admin-conversation-service.js
 * @description
 * 管理后台全局对话记录查询服务。
 *
 * 调用说明：
 * - `src/routes/web-routes.js` 的 `/admin/conversations` 调用 `listAdminConversations()` 渲染全局会话列表。
 * - `src/routes/web-routes.js` 的 `/admin/conversations/:id` 调用 `getAdminConversationDetail()` 查看单条会话完整消息。
 * - 支持按用户、角色卡、日期和删除状态筛选；后台可以恢复或永久删除软删除数据。
 */

const { query } = require('../lib/db');
const { invalidateConversationCache } = require('./conversation-service');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function normalizeDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function normalizePositiveInteger(value, fallback = 0) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function trimPreview(value = '', maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Hong_Kong', hour12: false });
}

function normalizeStatusFilter(value) {
  const raw = String(value || 'all').trim();
  return ['all', 'active', 'archived', 'deleted'].includes(raw) ? raw : 'all';
}

function buildConversationWhere(filters = {}) {
  const clauses = [];
  const params = [];
  const userId = normalizePositiveInteger(filters.userId);
  const characterId = normalizePositiveInteger(filters.characterId);
  const date = normalizeDate(filters.date);
  const status = normalizeStatusFilter(filters.status);

  if (status !== 'all') {
    clauses.push('c.status = ?');
    params.push(status);
  }

  if (userId) {
    clauses.push('c.user_id = ?');
    params.push(userId);
  }
  if (characterId) {
    clauses.push('c.character_id = ?');
    params.push(characterId);
  }
  if (date) {
    clauses.push('DATE(c.created_at) = ?');
    params.push(date);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
    normalized: { userId, characterId, date, status },
  };
}

async function listConversationFilterOptions() {
  const [users, characters] = await Promise.all([
    query(
      `SELECT u.id, u.username, u.nickname, COUNT(c.id) AS conversation_count
       FROM users u
       JOIN conversations c ON c.user_id = u.id
       GROUP BY u.id, u.username, u.nickname
       ORDER BY MAX(c.updated_at) DESC, u.id DESC
       LIMIT 300`,
    ),
    query(
      `SELECT ch.id, ch.name, COUNT(c.id) AS conversation_count
       FROM characters ch
       JOIN conversations c ON c.character_id = ch.id
       GROUP BY ch.id, ch.name
       ORDER BY MAX(c.updated_at) DESC, ch.id DESC
       LIMIT 300`,
    ),
  ]);

  return {
    users: users.map((user) => ({
      id: Number(user.id),
      label: user.nickname ? `${user.username}（${user.nickname}）` : user.username,
      count: Number(user.conversation_count || 0),
    })),
    characters: characters.map((character) => ({
      id: Number(character.id),
      label: character.name,
      count: Number(character.conversation_count || 0),
    })),
  };
}

async function listAdminConversations(options = {}) {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(options.pageSize || DEFAULT_PAGE_SIZE)));
  const requestedPage = Math.max(1, Number(options.page || 1));
  const { whereSql, params, normalized } = buildConversationWhere(options);

  const countRows = await query(
    `SELECT COUNT(*) AS total
     FROM conversations c
     JOIN users u ON u.id = c.user_id
     JOIN characters ch ON ch.id = c.character_id
     ${whereSql}`,
    params,
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  const limit = Number(pageSize);
  const skip = Number(offset);

  const rows = await query(
    `SELECT
       c.id,
       c.title,
       c.status,
       c.selected_model_mode,
       c.current_message_id,
       c.parent_conversation_id,
       c.branched_from_message_id,
       c.created_at,
       c.updated_at,
       c.last_message_at,
       c.deleted_at,
       u.id AS user_id,
       u.username,
       u.nickname,
       ch.id AS character_id,
       ch.name AS character_name,
       ch.visibility AS character_visibility,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
       (SELECT m.sender_type FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sequence_no DESC, m.id DESC LIMIT 1) AS latest_sender_type,
       (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sequence_no DESC, m.id DESC LIMIT 1) AS latest_message_content
     FROM conversations c
     JOIN users u ON u.id = c.user_id
     JOIN characters ch ON ch.id = c.character_id
     ${whereSql}
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT ${limit} OFFSET ${skip}`,
    params,
  );

  const filterOptions = await listConversationFilterOptions();

  return {
    conversations: rows.map((row) => ({
      ...row,
      id: Number(row.id),
      user_id: Number(row.user_id),
      character_id: Number(row.character_id),
      message_count: Number(row.message_count || 0),
      latest_message_preview: trimPreview(row.latest_message_content || ''),
      display_created_at: formatDateTime(row.created_at),
      display_updated_at: formatDateTime(row.updated_at),
      display_last_message_at: formatDateTime(row.last_message_at),
      display_deleted_at: formatDateTime(row.deleted_at),
    })),
    total,
    page,
    pageSize,
    totalPages,
    filters: normalized,
    filterOptions,
  };
}

async function getAdminConversationDetail(conversationId) {
  const id = normalizePositiveInteger(conversationId);
  if (!id) return null;

  const rows = await query(
    `SELECT
       c.*,
       u.username,
       u.nickname,
       ch.name AS character_name,
       ch.summary AS character_summary,
       ch.visibility AS character_visibility
     FROM conversations c
     JOIN users u ON u.id = c.user_id
     JOIN characters ch ON ch.id = c.character_id
     WHERE c.id = ?
     LIMIT 1`,
    [id],
  );
  const conversation = rows[0] || null;
  if (!conversation) return null;

  const messages = await query(
    `SELECT
       id,
       sender_type,
       content,
       sequence_no,
       status,
       parent_message_id,
       branch_from_message_id,
       edited_from_message_id,
       prompt_kind,
       created_at,
       deleted_at,
       metadata_json
     FROM messages
     WHERE conversation_id = ?
     ORDER BY sequence_no ASC, id ASC`,
    [id],
  );

  return {
    conversation: {
      ...conversation,
      display_created_at: formatDateTime(conversation.created_at),
      display_updated_at: formatDateTime(conversation.updated_at),
      display_last_message_at: formatDateTime(conversation.last_message_at),
      display_deleted_at: formatDateTime(conversation.deleted_at),
    },
    messages: messages.map((message) => ({
      ...message,
      display_created_at: formatDateTime(message.created_at),
      display_deleted_at: formatDateTime(message.deleted_at),
    })),
  };
}


async function restoreConversation(conversationId) {
  const id = normalizePositiveInteger(conversationId);
  if (!id) return false;
  const result = await query(
    "UPDATE conversations SET status = 'active', deleted_at = NULL, updated_at = NOW() WHERE id = ? AND status = 'deleted'",
    [id],
  );
  if (Number(result.affectedRows || 0) > 0) {
    await invalidateConversationCache(id);
    return true;
  }
  return false;
}

async function permanentlyDeleteConversation(conversationId) {
  const id = normalizePositiveInteger(conversationId);
  if (!id) return false;
  const rows = await query("SELECT id FROM conversations WHERE id = ? AND status = 'deleted' LIMIT 1", [id]);
  if (!rows.length) return false;
  await query('DELETE FROM messages WHERE conversation_id = ?', [id]);
  const result = await query("DELETE FROM conversations WHERE id = ? AND status = 'deleted'", [id]);
  await invalidateConversationCache(id);
  return Number(result.affectedRows || 0) > 0;
}

async function restoreMessage(conversationId, messageId) {
  const conversation = normalizePositiveInteger(conversationId);
  const message = normalizePositiveInteger(messageId);
  if (!conversation || !message) return false;
  const result = await query(
    "UPDATE messages SET deleted_at = NULL WHERE id = ? AND conversation_id = ? AND deleted_at IS NOT NULL",
    [message, conversation],
  );
  if (Number(result.affectedRows || 0) > 0) {
    await invalidateConversationCache(conversation);
    return true;
  }
  return false;
}

async function permanentlyDeleteMessage(conversationId, messageId) {
  const conversation = normalizePositiveInteger(conversationId);
  const message = normalizePositiveInteger(messageId);
  if (!conversation || !message) return false;
  const childRows = await query(
    'SELECT COUNT(*) AS childCount FROM messages WHERE conversation_id = ? AND parent_message_id = ?',
    [conversation, message],
  );
  if (Number(childRows[0]?.childCount || 0) > 0) {
    const error = new Error('MESSAGE_HAS_CHILDREN');
    error.code = 'MESSAGE_HAS_CHILDREN';
    error.childMessageCount = Number(childRows[0]?.childCount || 0);
    throw error;
  }
  const result = await query("DELETE FROM messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NOT NULL", [message, conversation]);
  if (Number(result.affectedRows || 0) > 0) {
    await invalidateConversationCache(conversation);
    return true;
  }
  return false;
}

module.exports = {
  getAdminConversationDetail,
  permanentlyDeleteConversation,
  permanentlyDeleteMessage,
  restoreConversation,
  restoreMessage,
  listAdminConversations,
  listConversationFilterOptions,
};
