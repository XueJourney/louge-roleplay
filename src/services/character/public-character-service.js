/**
 * @file src/services/character/public-character-service.js
 * @description 公共角色大厅、首页推荐与公开详情查询。
 */

const { query, getDbType } = require('../../lib/db');
const {
  attachTagsToCharacters,
  getCharacterTags,
  getTagSearchNames,
  parseTagInput,
} = require('../character-tag-service');

function getPublicCharacterSortSql(sort) {
  const dbType = getDbType();
  const heatExpr = '(COALESCE(like_stats.like_count, 0) * 3 + COALESCE(comment_stats.comment_count, 0) * 4 + COALESCE(usage_stats.usage_count, 0) * 2)';
  const randomSql = dbType === 'mysql' ? 'RAND()' : 'RANDOM()';
  const sortMap = {
    newest: 'c.id DESC',
    oldest: 'c.id ASC',
    likes: 'like_count DESC, c.id DESC',
    comments: 'comment_count DESC, c.id DESC',
    usage: 'usage_count DESC, c.id DESC',
    heat: `${heatExpr} DESC, c.id DESC`,
    random: randomSql,
  };
  return sortMap[sort] || sortMap.newest;
}

function normalizePublicCharacterSort(sort) {
  const value = String(sort || 'newest').trim();
  return ['newest', 'oldest', 'likes', 'comments', 'usage', 'heat', 'random'].includes(value) ? value : 'newest';
}

function getPublicCharacterStatsJoinSql() {
  return `
     LEFT JOIN (
       SELECT character_id, COUNT(*) AS like_count
       FROM character_likes
       GROUP BY character_id
     ) like_stats ON like_stats.character_id = c.id
     LEFT JOIN (
       SELECT character_id, COUNT(*) AS comment_count
       FROM character_comments
       WHERE status = 'visible'
       GROUP BY character_id
     ) comment_stats ON comment_stats.character_id = c.id
     LEFT JOIN (
       SELECT character_id, COUNT(*) AS usage_count
       FROM character_usage_events
       GROUP BY character_id
     ) usage_stats ON usage_stats.character_id = c.id`;
}

function getPublicCharacterSelectFields() {
  return `c.id, c.name, c.summary, c.visibility, c.is_nsfw, c.created_at, c.updated_at, c.avatar_image_path, u.username,
            COALESCE(like_stats.like_count, 0) AS like_count,
            COALESCE(comment_stats.comment_count, 0) AS comment_count,
            COALESCE(usage_stats.usage_count, 0) AS usage_count,
            (COALESCE(like_stats.like_count, 0) * 3 + COALESCE(comment_stats.comment_count, 0) * 4 + COALESCE(usage_stats.usage_count, 0) * 2) AS heat_score`;
}

function appendTagFilters(where, params, tagNames, tagMode) {
  const tagSearchNameGroups = tagNames.map((tagName) => getTagSearchNames(tagName));
  if (!tagSearchNameGroups.length) return;

  if (tagMode === 'and') {
    tagSearchNameGroups.forEach((searchNames) => {
      where.push(`EXISTS (
        SELECT 1 FROM character_tags filter_ct
        JOIN tags filter_t ON filter_t.id = filter_ct.tag_id
        WHERE filter_ct.character_id = c.id AND filter_t.is_enabled = 1 AND LOWER(filter_t.name) IN (${searchNames.map(() => 'LOWER(?)').join(',')})
      )`);
      params.push(...searchNames);
    });
    return;
  }

  const flattenedSearchNames = [...new Set(tagSearchNameGroups.flat())];
  where.push(`EXISTS (
    SELECT 1 FROM character_tags filter_ct
    JOIN tags filter_t ON filter_t.id = filter_ct.tag_id
    WHERE filter_ct.character_id = c.id AND filter_t.is_enabled = 1 AND LOWER(filter_t.name) IN (${flattenedSearchNames.map(() => 'LOWER(?)').join(',')})
  )`);
  params.push(...flattenedSearchNames);
}

async function listPublicCharacters(options = {}) {
  const page = Math.max(1, Number.parseInt(options.page || 1, 10));
  const pageSize = Math.min(48, Math.max(6, Number.parseInt(options.pageSize || 12, 10)));
  const offset = (page - 1) * pageSize;
  const keyword = String(options.keyword || '').trim();
  const sort = normalizePublicCharacterSort(options.sort);
  const sortSql = getPublicCharacterSortSql(sort);
  const where = ["c.visibility = 'public'", "c.status = 'published'"];
  const params = [];
  const includeNsfw = Boolean(options.includeNsfw);
  const tagNames = parseTagInput(options.tags);
  const tagMode = String(options.tagMode || 'or') === 'and' ? 'and' : 'or';

  if (!includeNsfw) {
    where.push('COALESCE(c.is_nsfw, 0) = 0');
  }

  appendTagFilters(where, params, tagNames, tagMode);

  if (keyword) {
    where.push('(c.name LIKE ? OR c.summary LIKE ? OR u.username LIKE ?)');
    const likeKeyword = `%${keyword}%`;
    params.push(likeKeyword, likeKeyword, likeKeyword);
  }

  const whereSql = where.join(' AND ');
  const rows = await query(
    `SELECT ${getPublicCharacterSelectFields()}
     FROM characters c
     JOIN users u ON u.id = c.user_id
     ${getPublicCharacterStatsJoinSql()}
     WHERE ${whereSql}
     ORDER BY ${sortSql}
     LIMIT ${pageSize} OFFSET ${offset}`,
    params,
  );
  const countRows = await query(
    `SELECT COUNT(*) AS total
     FROM characters c
     JOIN users u ON u.id = c.user_id
     WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRows[0]?.total || 0);
  const characters = await attachTagsToCharacters(rows);

  return {
    characters,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasPrev: page > 1,
      hasNext: page * pageSize < total,
    },
    filters: {
      keyword,
      sort,
      tags: tagNames,
      tagMode,
      includeNsfw,
    },
  };
}

async function listFeaturedPublicCharacters(limit = 6, options = {}) {
  const safeLimit = Math.min(12, Math.max(1, Number.parseInt(limit || 6, 10)));
  const limitSql = Number(safeLimit);
  const where = ["c.visibility = 'public'", "c.status = 'published'"];
  const params = [];
  if (!options.includeNsfw) {
    where.push('COALESCE(c.is_nsfw, 0) = 0');
  }
  const rows = await query(
    `SELECT ${getPublicCharacterSelectFields()}
     FROM characters c
     JOIN users u ON u.id = c.user_id
     ${getPublicCharacterStatsJoinSql()}
     WHERE ${where.join(' AND ')}
     ORDER BY heat_score DESC, c.id DESC
     LIMIT ${limitSql}`,
    params,
  );
  return attachTagsToCharacters(rows);
}

async function getPublicCharacterDetail(characterId, options = {}) {
  const where = ['c.id = ?', "c.visibility = 'public'", "c.status = 'published'"];
  const params = [characterId];
  if (!options.includeNsfw) {
    where.push('COALESCE(c.is_nsfw, 0) = 0');
  }
  const rows = await query(
    `SELECT c.id, c.name, c.summary, c.avatar_image_path, c.is_nsfw
     FROM characters c
     WHERE ${where.join(' AND ')}
     LIMIT 1`,
    params,
  );
  const character = rows[0] || null;
  if (!character) return null;
  character.tags = await getCharacterTags(character.id);
  return character;
}

module.exports = {
  listPublicCharacters,
  listFeaturedPublicCharacters,
  getPublicCharacterDetail,
};
