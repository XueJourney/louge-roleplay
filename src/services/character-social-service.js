/**
 * @file src/services/character-social-service.js
 * @description 公开角色点赞、评论、使用量与热度统计服务。
 */

'use strict';

const { query, withTransaction } = require('../lib/db');

function normalizeCommentBody(body) {
  return String(body || '').trim().slice(0, 500);
}

async function ensurePublicCharacter(characterId) {
  const rows = await query(
    "SELECT id FROM characters WHERE id = ? AND visibility = 'public' AND status = 'published' LIMIT 1",
    [characterId],
  );
  return rows[0] || null;
}

async function toggleCharacterLike(characterId, userId) {
  const character = await ensurePublicCharacter(characterId);
  if (!character) {
    const error = new Error('CHARACTER_NOT_FOUND');
    error.code = 'CHARACTER_NOT_FOUND';
    throw error;
  }

  return withTransaction(async (conn) => {
    const [existingRows] = await conn.execute(
      'SELECT id FROM character_likes WHERE character_id = ? AND user_id = ? LIMIT 1',
      [characterId, userId],
    );

    if (existingRows.length > 0) {
      await conn.execute('DELETE FROM character_likes WHERE id = ?', [existingRows[0].id]);
      return { liked: false };
    }

    await conn.execute(
      'INSERT INTO character_likes (character_id, user_id, created_at) VALUES (?, ?, NOW())',
      [characterId, userId],
    );
    return { liked: true };
  });
}

async function addCharacterComment(characterId, userId, body) {
  const character = await ensurePublicCharacter(characterId);
  if (!character) {
    const error = new Error('CHARACTER_NOT_FOUND');
    error.code = 'CHARACTER_NOT_FOUND';
    throw error;
  }

  const normalizedBody = normalizeCommentBody(body);
  if (!normalizedBody) {
    const error = new Error('COMMENT_EMPTY');
    error.code = 'COMMENT_EMPTY';
    throw error;
  }

  await query(
    `INSERT INTO character_comments (character_id, user_id, body, status, created_at, updated_at)
     VALUES (?, ?, ?, 'visible', NOW(), NOW())`,
    [characterId, userId, normalizedBody],
  );
}

async function listCharacterComments(characterId, limit = 3) {
  const safeLimit = Math.min(10, Math.max(1, Number.parseInt(limit || 3, 10)));
  return query(
    `SELECT cc.id, cc.body, cc.created_at, u.username
     FROM character_comments cc
     JOIN users u ON u.id = cc.user_id
     WHERE cc.character_id = ? AND cc.status = 'visible'
     ORDER BY cc.id DESC
     LIMIT ${safeLimit}`,
    [characterId],
  );
}

async function markCharacterUsed(characterId, userId) {
  await query(
    `INSERT INTO character_usage_events (character_id, user_id, created_at)
     VALUES (?, ?, NOW())`,
    [characterId, userId],
  );
}

module.exports = {
  toggleCharacterLike,
  addCharacterComment,
  listCharacterComments,
  markCharacterUsed,
};
