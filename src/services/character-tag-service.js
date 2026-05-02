/**
 * @file src/services/character-tag-service.js
 * @description 角色多标签服务：标签归一化、创建、关联、公开筛选辅助。
 */

'use strict';

const crypto = require('node:crypto');
const OpenCC = require('opencc-js');
const { query } = require('../lib/db');

const MAX_TAGS_PER_CHARACTER = 12;
const MAX_TAG_NAME_LENGTH = 32;
const simplifiedToTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });
const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

function normalizeTagName(value) {
  return simplifiedToTraditional(String(value || ''))
    .normalize('NFC')
    .replace(/[#＃]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TAG_NAME_LENGTH);
}

function normalizeTagSlug(value) {
  const base = normalizeTagName(value)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (base) return base;
  return `tag-${crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12)}`;
}

function getTagSearchNames(value) {
  const normalizedName = normalizeTagName(value);
  const simplifiedName = traditionalToSimplified(normalizedName).normalize('NFC');
  return [...new Set([normalizedName, simplifiedName].filter(Boolean))];
}

function uniqueTagNames(values = []) {
  const result = [];
  const seen = new Set();
  values.forEach((value) => {
    const name = normalizeTagName(value);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(name);
  });
  return result.slice(0, MAX_TAGS_PER_CHARACTER);
}

function parseTagInput(value) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || '').split(/[，,\n]/g);
  return uniqueTagNames(rawItems);
}

async function runSql(conn, sql, params = []) {
  if (conn?.execute) {
    const result = await conn.execute(sql, params);
    if (Array.isArray(result)) {
      return result[0];
    }
    return result;
  }
  return query(sql, params);
}

async function ensureTagByName(name, conn = null) {
  const normalizedName = normalizeTagName(name);
  if (!normalizedName) return null;
  const slug = normalizeTagSlug(normalizedName);

  const existing = await runSql(
    conn,
    `SELECT id, name, slug FROM tags WHERE slug = ? OR name IN (${getTagSearchNames(normalizedName).map(() => '?').join(',')}) LIMIT 1`,
    [slug, ...getTagSearchNames(normalizedName)],
  );
  if (existing[0]) {
    return existing[0];
  }

  try {
    const result = await runSql(
      conn,
      `INSERT INTO tags (name, slug, description, color, icon, is_nsfw, is_enabled, sort_order, usage_count, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, 0, 1, 0, 0, NOW(), NOW())`,
      [normalizedName, slug],
    );
    return { id: Number(result.insertId), name: normalizedName, slug };
  } catch (error) {
    if (!/duplicate|unique|uniq/i.test(String(error?.message || ''))) {
      throw error;
    }
    const searchNames = getTagSearchNames(normalizedName);
    const rows = await runSql(
      conn,
      `SELECT id, name, slug FROM tags WHERE slug = ? OR name IN (${searchNames.map(() => '?').join(',')}) LIMIT 1`,
      [slug, ...searchNames],
    );
    return rows[0] || null;
  }
}

async function setCharacterTags(characterId, tagValues = [], conn = null) {
  const id = Number(characterId || 0);
  if (!id) return [];
  const names = uniqueTagNames(tagValues);

  await runSql(conn, 'DELETE FROM character_tags WHERE character_id = ?', [id]);
  const attached = [];
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop
    const tag = await ensureTagByName(name, conn);
    if (!tag?.id) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await runSql(
        conn,
        'INSERT INTO character_tags (character_id, tag_id, created_at) VALUES (?, ?, NOW())',
        [id, tag.id],
      );
    } catch (error) {
      if (!/duplicate|unique|uniq/i.test(String(error?.message || ''))) {
        throw error;
      }
    }
    attached.push(tag);
  }

  // usage_count 是缓存字段，失败不影响主流程。
  try {
    await runSql(
      conn,
      `UPDATE tags
       SET usage_count = (SELECT COUNT(*) FROM character_tags WHERE character_tags.tag_id = tags.id), updated_at = NOW()
       WHERE id IN (${attached.map(() => '?').join(',') || 'NULL'})`,
      attached.map((tag) => tag.id),
    );
  } catch (_) {}

  return attached;
}

async function getTagsForCharacterIds(characterIds = []) {
  const ids = [...new Set(characterIds.map((id) => Number(id || 0)).filter((id) => id > 0))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await query(
    `SELECT ct.character_id, t.id, t.name, t.slug, t.color, t.icon, t.is_nsfw
     FROM character_tags ct
     JOIN tags t ON t.id = ct.tag_id
     WHERE ct.character_id IN (${placeholders}) AND t.is_enabled = 1
     ORDER BY t.sort_order ASC, t.name ASC`,
    ids,
  );
  const byCharacter = new Map(ids.map((id) => [id, []]));
  rows.forEach((row) => {
    const characterId = Number(row.character_id || 0);
    if (!byCharacter.has(characterId)) byCharacter.set(characterId, []);
    byCharacter.get(characterId).push({
      id: Number(row.id),
      name: row.name,
      slug: row.slug,
      color: row.color || '',
      icon: row.icon || '',
      is_nsfw: Number(row.is_nsfw || 0),
    });
  });
  return byCharacter;
}

async function attachTagsToCharacters(characters = []) {
  const list = Array.isArray(characters) ? characters : [];
  const tagsByCharacter = await getTagsForCharacterIds(list.map((item) => item.id));
  return list.map((character) => ({
    ...character,
    tags: tagsByCharacter.get(Number(character.id)) || [],
  }));
}

async function getCharacterTags(characterId) {
  const tagsByCharacter = await getTagsForCharacterIds([characterId]);
  return tagsByCharacter.get(Number(characterId)) || [];
}

async function listAllTags() {
  return query(
    `SELECT id, name, slug, description, color, icon, is_nsfw, is_enabled, sort_order, usage_count
     FROM tags
     ORDER BY is_enabled DESC, sort_order ASC, name ASC`,
  );
}

async function listPublicTags(options = {}) {
  const includeNsfw = Boolean(options.includeNsfw);
  const where = ["c.visibility = 'public'", "c.status = 'published'", 't.is_enabled = 1'];
  const params = [];
  if (!includeNsfw) {
    where.push('COALESCE(c.is_nsfw, 0) = 0');
    where.push('COALESCE(t.is_nsfw, 0) = 0');
  }
  return query(
    `SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_nsfw, COUNT(DISTINCT c.id) AS usage_count
     FROM tags t
     JOIN character_tags ct ON ct.tag_id = t.id
     JOIN characters c ON c.id = ct.character_id
     WHERE ${where.join(' AND ')}
     GROUP BY t.id, t.name, t.slug, t.color, t.icon, t.is_nsfw
     HAVING COUNT(DISTINCT c.id) > 0
     ORDER BY usage_count DESC, t.sort_order ASC, t.name ASC
     LIMIT 200`,
    params,
  );
}

module.exports = {
  MAX_TAGS_PER_CHARACTER,
  normalizeTagName,
  normalizeTagSlug,
  getTagSearchNames,
  parseTagInput,
  uniqueTagNames,
  ensureTagByName,
  setCharacterTags,
  getCharacterTags,
  getTagsForCharacterIds,
  attachTagsToCharacters,
  listAllTags,
  listPublicTags,
};
