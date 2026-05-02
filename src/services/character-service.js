/**
 * @file src/services/character-service.js
 * @description 角色创建、编辑、列表查询与详情读取服务。
 */

const { query } = require('../lib/db');
const { clampCharacterField } = require('../constants/character-limits');
const { normalizeStoredImagePath, deleteStoredImageIfOwned } = require('./upload-service');
const {
  attachTagsToCharacters,
  getCharacterTags,
  parseTagInput,
  setCharacterTags,
} = require('./character-tag-service');
const { ensureCharacterImageColumns } = require('./character/schema-service');
const {
  listPublicCharacters,
  listFeaturedPublicCharacters,
  getPublicCharacterDetail,
} = require('./character/public-character-service');

function stringifyPromptProfile(payload) {
  if (!payload || payload === '[]') {
    return null;
  }
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

function normalizeVisibility(value) {
  return String(value || '').trim() === 'private' ? 'private' : 'public';
}

async function countCharacterConversations(characterId) {
  const rows = await query(
    "SELECT COUNT(*) AS conversationCount FROM conversations WHERE character_id = ? AND status <> 'deleted'",
    [characterId],
  );
  return Number(rows[0]?.conversationCount || 0);
}

async function createCharacter(userId, payload) {
  const visibility = normalizeVisibility(payload.visibility);
  const result = await query(
    `INSERT INTO characters (
      user_id, name, summary, personality, first_message, prompt_profile_json, visibility, avatar_image_path, background_image_path, status, is_nsfw, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, NOW(), NOW())`,
    [
      userId,
      clampCharacterField(payload.name),
      clampCharacterField(payload.summary),
      clampCharacterField(payload.personality),
      clampCharacterField(payload.firstMessage),
      stringifyPromptProfile(payload.promptProfileJson || '[]'),
      visibility,
      normalizeStoredImagePath(payload.avatarImagePath),
      normalizeStoredImagePath(payload.backgroundImagePath),
      payload.isNsfw ? 1 : 0,
    ],
  );
  await setCharacterTags(result.insertId, parseTagInput(payload.tags));
  return result.insertId;
}

async function updateCharacter(characterId, userId, payload) {
  const visibility = normalizeVisibility(payload.visibility);
  const result = await query(
    `UPDATE characters
     SET name = ?,
         summary = ?,
         personality = ?,
         first_message = ?,
         prompt_profile_json = ?,
         visibility = ?,
         is_nsfw = ?,
         avatar_image_path = ?,
         background_image_path = ?,
         updated_at = NOW()
     WHERE id = ? AND user_id = ?`,
    [
      clampCharacterField(payload.name),
      clampCharacterField(payload.summary),
      clampCharacterField(payload.personality),
      clampCharacterField(payload.firstMessage),
      stringifyPromptProfile(payload.promptProfileJson || '[]'),
      visibility,
      payload.isNsfw ? 1 : 0,
      normalizeStoredImagePath(payload.avatarImagePath),
      normalizeStoredImagePath(payload.backgroundImagePath),
      characterId,
      userId,
    ],
  );
  if (Number(result.affectedRows || 0) > 0) {
    await setCharacterTags(characterId, parseTagInput(payload.tags));
  }
}

async function listUserCharacters(userId) {
  const rows = await query(
    `SELECT id, name, summary, personality, first_message, prompt_profile_json, visibility, status, is_nsfw, avatar_image_path, background_image_path, created_at
     FROM characters WHERE user_id = ? AND status <> 'blocked' ORDER BY id DESC`,
    [userId],
  );
  return attachTagsToCharacters(rows);
}

async function getCharacterById(id, userId = null, options = {}) {
  const params = [id];
  let whereClause = 'WHERE c.id = ?';

  if (!options.includeBlocked) {
    whereClause += " AND c.status <> 'blocked'";
  }

  if (userId !== null && userId !== undefined) {
    whereClause += ' AND c.user_id = ?';
    params.push(userId);
  }

  const rows = await query(
    `SELECT c.*, u.username
     FROM characters c
     JOIN users u ON u.id = c.user_id
     ${whereClause}
     LIMIT 1`,
    params,
  );
  const character = rows[0] || null;
  if (!character) return null;
  character.tags = await getCharacterTags(character.id);
  return character;
}

async function deleteCharacterSafely(characterId, userId) {
  const character = await getCharacterById(characterId, userId);
  if (!character) {
    const error = new Error('CHARACTER_NOT_FOUND');
    error.code = 'CHARACTER_NOT_FOUND';
    throw error;
  }

  const conversationCount = await countCharacterConversations(characterId);
  if (conversationCount > 0) {
    const error = new Error('CHARACTER_HAS_CONVERSATIONS');
    error.code = 'CHARACTER_HAS_CONVERSATIONS';
    error.conversationCount = conversationCount;
    throw error;
  }

  await query('DELETE FROM characters WHERE id = ? AND user_id = ?', [characterId, userId]);
  deleteStoredImageIfOwned(character.avatar_image_path);
  deleteStoredImageIfOwned(character.background_image_path);
}


module.exports = {
  ensureCharacterImageColumns,
  createCharacter,
  updateCharacter,
  listPublicCharacters,
  listFeaturedPublicCharacters,
  getPublicCharacterDetail,
  listUserCharacters,
  getCharacterById,
  countCharacterConversations,
  deleteCharacterSafely,
};
