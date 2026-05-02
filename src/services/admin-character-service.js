/**
 * @file src/services/admin-character-service.js
 * @description 管理后台全局角色卡查询、禁用、删除与关联对话入口服务。
 */

'use strict';

const { query, withTransaction, getDbType } = require('../lib/db');
const { deleteStoredImageIfOwned } = require('./upload-service');
const { attachTagsToCharacters, getCharacterTags } = require('./character-tag-service');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const VALID_STATUSES = new Set(['draft', 'published', 'blocked']);
const VALID_VISIBILITIES = new Set(['public', 'private', 'unlisted']);

function normalizePositiveInteger(value, fallback = 0) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function normalizeStatusFilter(value) {
  const raw = String(value || 'all').trim();
  return raw === 'all' || VALID_STATUSES.has(raw) ? raw : 'all';
}

function normalizeVisibilityFilter(value) {
  const raw = String(value || 'all').trim();
  return raw === 'all' || VALID_VISIBILITIES.has(raw) ? raw : 'all';
}

function normalizeKeyword(value) {
  return String(value || '').trim().slice(0, 120);
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

function buildCharacterWhere(filters = {}) {
  const clauses = [];
  const params = [];
  const userId = normalizePositiveInteger(filters.userId);
  const keyword = normalizeKeyword(filters.keyword);
  const status = normalizeStatusFilter(filters.status);
  const visibility = normalizeVisibilityFilter(filters.visibility);

  if (userId) {
    clauses.push('c.user_id = ?');
    params.push(userId);
  }
  if (status !== 'all') {
    clauses.push('c.status = ?');
    params.push(status);
  }
  if (visibility !== 'all') {
    clauses.push('c.visibility = ?');
    params.push(visibility);
  }
  if (keyword) {
    clauses.push('(c.name LIKE ? OR c.summary LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?)');
    const likeKeyword = `%${keyword}%`;
    params.push(likeKeyword, likeKeyword, likeKeyword, likeKeyword);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
    normalized: { userId, keyword, status, visibility },
  };
}

async function listCharacterFilterUsers() {
  const users = await query(
    `SELECT u.id, u.username, u.nickname, COUNT(c.id) AS character_count
     FROM users u
     JOIN characters c ON c.user_id = u.id
     GROUP BY u.id, u.username, u.nickname
     ORDER BY MAX(c.updated_at) DESC, u.id DESC
     LIMIT 300`,
  );

  return users.map((user) => ({
    id: Number(user.id),
    label: user.nickname ? `${user.username}（${user.nickname}）` : user.username,
    count: Number(user.character_count || 0),
  }));
}

function parsePromptProfileItems(value) {
  if (!value) return [];
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value || '[]');
    } catch (_) {
      return [];
    }
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items
    .map((item, index) => ({
      key: String(item?.key || '').trim(),
      value: String(item?.value || '').trim(),
      isEnabled: item?.isEnabled === undefined ? Boolean(Number(item?.is_enabled ?? 1)) : Boolean(item.isEnabled),
      sortOrder: Number(item?.sortOrder ?? item?.sort_order ?? index),
    }))
    .filter((item) => item.key || item.value)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

async function getCharacterFilterStats(options = {}) {
  const { whereSql, params } = buildCharacterWhere(options);
  const rows = await query(
    `SELECT
       COUNT(*) AS total_characters,
       COALESCE(SUM((SELECT COUNT(*) FROM conversations conv WHERE conv.character_id = c.id)), 0) AS total_conversations,
       COALESCE(SUM((SELECT COUNT(*) FROM conversations conv WHERE conv.character_id = c.id AND conv.status <> 'deleted')), 0) AS active_conversations,
       COALESCE(SUM((SELECT COUNT(*) FROM character_likes cl WHERE cl.character_id = c.id)), 0) AS total_likes,
       COALESCE(SUM((SELECT COUNT(*) FROM character_comments cc WHERE cc.character_id = c.id AND cc.status = 'visible')), 0) AS total_comments,
       COALESCE(SUM((SELECT COUNT(*) FROM character_usage_events cue WHERE cue.character_id = c.id)), 0) AS total_usage_events
     FROM characters c
     JOIN users u ON u.id = c.user_id
     ${whereSql}`,
    params,
  );
  const row = rows[0] || {};
  return {
    totalCharacters: Number(row.total_characters || 0),
    totalConversations: Number(row.total_conversations || 0),
    activeConversations: Number(row.active_conversations || 0),
    totalLikes: Number(row.total_likes || 0),
    totalComments: Number(row.total_comments || 0),
    totalUsageEvents: Number(row.total_usage_events || 0),
  };
}

async function listAdminCharacters(options = {}) {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(options.pageSize || DEFAULT_PAGE_SIZE)));
  const requestedPage = Math.max(1, Number(options.page || 1));
  const { whereSql, params, normalized } = buildCharacterWhere(options);

  const countRows = await query(
    `SELECT COUNT(*) AS total
     FROM characters c
     JOIN users u ON u.id = c.user_id
     ${whereSql}`,
    params,
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const rows = await query(
    `SELECT
       c.id,
       c.user_id,
       c.name,
       c.summary,
       c.personality,
       c.first_message,
       c.visibility,
       c.status,
       c.is_nsfw,
       c.created_at,
       c.updated_at,
       u.username,
       u.nickname,
       (SELECT COUNT(*) FROM conversations conv WHERE conv.character_id = c.id) AS conversation_count,
       (SELECT COUNT(*) FROM conversations conv WHERE conv.character_id = c.id AND conv.status <> 'deleted') AS active_conversation_count,
       (SELECT COUNT(*) FROM character_likes cl WHERE cl.character_id = c.id) AS like_count,
       (SELECT COUNT(*) FROM character_comments cc WHERE cc.character_id = c.id AND cc.status = 'visible') AS comment_count,
       (SELECT COUNT(*) FROM character_usage_events cue WHERE cue.character_id = c.id) AS usage_count,
       (SELECT MAX(conv.updated_at) FROM conversations conv WHERE conv.character_id = c.id) AS latest_conversation_at
     FROM characters c
     JOIN users u ON u.id = c.user_id
     ${whereSql}
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}`,
    params,
  );

  const [filterUsers, stats] = await Promise.all([
    listCharacterFilterUsers(),
    getCharacterFilterStats(options),
  ]);

  const rowsWithTags = await attachTagsToCharacters(rows);

  return {
    characters: rowsWithTags.map((row) => ({
      ...row,
      id: Number(row.id),
      user_id: Number(row.user_id),
      conversation_count: Number(row.conversation_count || 0),
      active_conversation_count: Number(row.active_conversation_count || 0),
      like_count: Number(row.like_count || 0),
      comment_count: Number(row.comment_count || 0),
      usage_count: Number(row.usage_count || 0),
      summary_preview: trimPreview(row.summary || row.personality || row.first_message || ''),
      display_created_at: formatDateTime(row.created_at),
      display_updated_at: formatDateTime(row.updated_at),
      display_latest_conversation_at: formatDateTime(row.latest_conversation_at),
    })),
    total,
    page,
    pageSize,
    totalPages,
    stats: {
      ...stats,
      totalCharacters: total,
    },
    filters: normalized,
    filterOptions: { users: filterUsers },
  };
}

async function getAdminCharacterDetail(characterId) {
  const id = normalizePositiveInteger(characterId);
  if (!id) return null;

  const rows = await query(
    `SELECT
       c.*,
       u.username,
       u.nickname,
       (SELECT COUNT(*) FROM conversations conv WHERE conv.character_id = c.id) AS conversation_count,
       (SELECT COUNT(*) FROM conversations conv WHERE conv.character_id = c.id AND conv.status <> 'deleted') AS active_conversation_count,
       (SELECT COUNT(*) FROM conversations conv WHERE conv.character_id = c.id AND conv.status = 'deleted') AS deleted_conversation_count,
       (SELECT COUNT(*) FROM messages m JOIN conversations conv ON conv.id = m.conversation_id WHERE conv.character_id = c.id) AS message_count,
       (SELECT COUNT(*) FROM character_likes cl WHERE cl.character_id = c.id) AS like_count,
       (SELECT COUNT(*) FROM character_comments cc WHERE cc.character_id = c.id AND cc.status = 'visible') AS comment_count,
       (SELECT COUNT(*) FROM character_usage_events cue WHERE cue.character_id = c.id) AS usage_count,
       (SELECT MAX(conv.updated_at) FROM conversations conv WHERE conv.character_id = c.id) AS latest_conversation_at
     FROM characters c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = ?
     LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;

  const recentConversations = await query(
    `SELECT conv.id, conv.title, conv.status, conv.created_at, conv.updated_at, conv.last_message_at, u.username, u.nickname,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = conv.id) AS message_count
     FROM conversations conv
     JOIN users u ON u.id = conv.user_id
     WHERE conv.character_id = ?
     ORDER BY conv.updated_at DESC, conv.id DESC
     LIMIT 12`,
    [id],
  );

  const recentComments = await query(
    `SELECT cc.id, cc.body, cc.status, cc.created_at, cc.updated_at, u.username, u.nickname
     FROM character_comments cc
     JOIN users u ON u.id = cc.user_id
     WHERE cc.character_id = ?
     ORDER BY cc.created_at DESC, cc.id DESC
     LIMIT 12`,
    [id],
  );

  const character = {
    ...row,
    id: Number(row.id),
    user_id: Number(row.user_id),
    conversation_count: Number(row.conversation_count || 0),
    active_conversation_count: Number(row.active_conversation_count || 0),
    deleted_conversation_count: Number(row.deleted_conversation_count || 0),
    message_count: Number(row.message_count || 0),
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    usage_count: Number(row.usage_count || 0),
    prompt_profile_items: parsePromptProfileItems(row.prompt_profile_json),
    tags: await getCharacterTags(row.id),
    display_created_at: formatDateTime(row.created_at),
    display_updated_at: formatDateTime(row.updated_at),
    display_latest_conversation_at: formatDateTime(row.latest_conversation_at),
  };

  return {
    character,
    recentConversations: recentConversations.map((conversation) => ({
      ...conversation,
      id: Number(conversation.id),
      message_count: Number(conversation.message_count || 0),
      display_created_at: formatDateTime(conversation.created_at),
      display_updated_at: formatDateTime(conversation.updated_at),
      display_last_message_at: formatDateTime(conversation.last_message_at),
    })),
    recentComments: recentComments.map((comment) => ({
      ...comment,
      id: Number(comment.id),
      display_created_at: formatDateTime(comment.created_at),
      display_updated_at: formatDateTime(comment.updated_at),
    })),
  };
}

async function getAdminCharacterById(characterId) {
  const id = normalizePositiveInteger(characterId);
  if (!id) return null;
  const rows = await query(
    `SELECT c.*, u.username, u.nickname
     FROM characters c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = ?
     LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function updateAdminCharacterStatus(characterId, status) {
  const id = normalizePositiveInteger(characterId);
  const normalizedStatus = String(status || '').trim();
  if (!id || !VALID_STATUSES.has(normalizedStatus)) {
    return false;
  }
  const result = await query('UPDATE characters SET status = ?, updated_at = NOW() WHERE id = ?', [normalizedStatus, id]);
  return Number(result.affectedRows || 0) > 0;
}

async function deleteAdminCharacter(characterId) {
  const id = normalizePositiveInteger(characterId);
  if (!id) return { deleted: false, reason: 'invalid-id' };

  let imagePaths = { avatarImagePath: null, backgroundImagePath: null };

  const result = await withTransaction(async (conn) => {
    const [characterRows] = await conn.execute('SELECT id, avatar_image_path, background_image_path FROM characters WHERE id = ? LIMIT 1', [id]);
    if (!characterRows.length) {
      return { deleted: false, reason: 'not-found' };
    }

    imagePaths = {
      avatarImagePath: characterRows[0].avatar_image_path || null,
      backgroundImagePath: characterRows[0].background_image_path || null,
    };

    const [conversationRows] = await conn.execute('SELECT id FROM conversations WHERE character_id = ?', [id]);
    const conversationIds = conversationRows.map((row) => Number(row.id)).filter((value) => value > 0);

    if (conversationIds.length) {
      const placeholders = conversationIds.map(() => '?').join(',');
      await conn.execute(`DELETE FROM messages WHERE conversation_id IN (${placeholders})`, conversationIds);
      await conn.execute(`DELETE FROM llm_usage_logs WHERE conversation_id IN (${placeholders})`, conversationIds);
      await conn.execute(`DELETE FROM conversations WHERE id IN (${placeholders})`, conversationIds);
    }

    await conn.execute('DELETE FROM character_likes WHERE character_id = ?', [id]);
    await conn.execute('DELETE FROM character_comments WHERE character_id = ?', [id]);
    await conn.execute('DELETE FROM character_usage_events WHERE character_id = ?', [id]);
    await conn.execute('DELETE FROM character_tags WHERE character_id = ?', [id]);
    const [result] = await conn.execute('DELETE FROM characters WHERE id = ?', [id]);

    return {
      deleted: Number(result?.affectedRows || 0) > 0,
      deletedConversations: conversationIds.length,
    };
  });

  if (result.deleted) {
    deleteStoredImageIfOwned(imagePaths.avatarImagePath);
    deleteStoredImageIfOwned(imagePaths.backgroundImagePath);
  }

  return result;
}

async function ensureCharactersStatusEnumSupportsBlocked() {
  if (getDbType() !== 'mysql') {
    return false;
  }
  await query(
    `ALTER TABLE \`characters\`
     MODIFY COLUMN \`status\`
       ENUM('draft','published','blocked')
       NOT NULL DEFAULT 'published'`,
  );
  return true;
}

module.exports = {
  deleteAdminCharacter,
  ensureCharactersStatusEnumSupportsBlocked,
  getAdminCharacterDetail,
  getAdminCharacterById,
  listAdminCharacters,
  getCharacterFilterStats,
  updateAdminCharacterStatus,
};
