/**
 * @file src/services/character-service.js
 * @description 角色创建、编辑、列表查询与详情读取服务。
 */

const { query, getDbType } = require('../lib/db');
const { MAX_CHARACTER_FIELD_LENGTH, clampCharacterField } = require('../constants/character-limits');
const { normalizeStoredImagePath, deleteStoredImageIfOwned } = require('./upload-service');
const {
  attachTagsToCharacters,
  getCharacterTags,
  getTagSearchNames,
  parseTagInput,
  setCharacterTags,
} = require('./character-tag-service');

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
  const tagSearchNameGroups = tagNames.map((tagName) => getTagSearchNames(tagName));
  const tagMode = String(options.tagMode || 'or') === 'and' ? 'and' : 'or';

  if (!includeNsfw) {
    where.push('COALESCE(c.is_nsfw, 0) = 0');
  }

  if (tagNames.length) {
    if (tagMode === 'and') {
      tagSearchNameGroups.forEach((searchNames) => {
        where.push(`EXISTS (
          SELECT 1 FROM character_tags filter_ct
          JOIN tags filter_t ON filter_t.id = filter_ct.tag_id
          WHERE filter_ct.character_id = c.id AND filter_t.is_enabled = 1 AND LOWER(filter_t.name) IN (${searchNames.map(() => 'LOWER(?)').join(',')})
        )`);
        params.push(...searchNames);
      });
    } else {
      const flattenedSearchNames = [...new Set(tagSearchNameGroups.flat())];
      where.push(`EXISTS (
        SELECT 1 FROM character_tags filter_ct
        JOIN tags filter_t ON filter_t.id = filter_ct.tag_id
        WHERE filter_ct.character_id = c.id AND filter_t.is_enabled = 1 AND LOWER(filter_t.name) IN (${flattenedSearchNames.map(() => 'LOWER(?)').join(',')})
      )`);
      params.push(...flattenedSearchNames);
    }
  }

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


async function mysqlColumnExists(tableName, columnName) {
  const rows = await query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function mysqlIndexExists(tableName, indexName) {
  const rows = await query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName],
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function ensureMysqlColumn(tableName, columnName, definitionSql) {
  if (await mysqlColumnExists(tableName, columnName)) return;
  await query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definitionSql}`);
}

async function ensureMysqlIndex(tableName, indexName, columnsSql) {
  if (await mysqlIndexExists(tableName, indexName)) return;
  await query(`ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` ${columnsSql}`);
}

async function ensureCharacterImageColumns() {
  if (getDbType() === 'mysql') {
    await query(`ALTER TABLE \`characters\` MODIFY COLUMN \`name\` VARCHAR(${MAX_CHARACTER_FIELD_LENGTH}) NOT NULL`);
    await query(`ALTER TABLE \`characters\` MODIFY COLUMN \`summary\` VARCHAR(${MAX_CHARACTER_FIELD_LENGTH}) NOT NULL`);
    await query('ALTER TABLE `characters` MODIFY COLUMN `personality` TEXT NULL');
    await query('ALTER TABLE `characters` MODIFY COLUMN `first_message` TEXT NULL');
    await ensureMysqlColumn('characters', 'avatar_image_path', '`avatar_image_path` VARCHAR(500) NULL');
    await ensureMysqlColumn('characters', 'background_image_path', '`background_image_path` VARCHAR(500) NULL');
    await ensureMysqlColumn('characters', 'is_nsfw', '`is_nsfw` TINYINT(1) NOT NULL DEFAULT 0');
    await ensureMysqlColumn('characters', 'source_type', '`source_type` VARCHAR(40) NULL');
    await ensureMysqlColumn('characters', 'source_format', '`source_format` VARCHAR(80) NULL');
    await ensureMysqlColumn('characters', 'source_file_name', '`source_file_name` VARCHAR(255) NULL');
    await ensureMysqlColumn('characters', 'source_file_hash', '`source_file_hash` VARCHAR(64) NULL');
    await ensureMysqlColumn('characters', 'source_card_json', '`source_card_json` JSON NULL');
    await ensureMysqlColumn('characters', 'imported_world_book_json', '`imported_world_book_json` JSON NULL');
    await ensureMysqlColumn('characters', 'flattened_world_book_text', '`flattened_world_book_text` LONGTEXT NULL');
    await ensureMysqlColumn('characters', 'import_batch_id', '`import_batch_id` BIGINT NULL');
    await ensureMysqlIndex('characters', 'idx_characters_source_file_hash', '(`source_file_hash`)');
    await ensureMysqlColumn('users', 'show_nsfw', '`show_nsfw` TINYINT(1) NOT NULL DEFAULT 0');
    await query(`CREATE TABLE IF NOT EXISTS tags (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(32) NOT NULL,
      slug VARCHAR(80) NOT NULL,
      description VARCHAR(255) NULL,
      color VARCHAR(32) NULL,
      icon VARCHAR(32) NULL,
      is_nsfw TINYINT(1) NOT NULL DEFAULT 0,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      usage_count INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY uniq_tags_slug (slug),
      INDEX idx_tags_enabled_sort (is_enabled, sort_order, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await query(`CREATE TABLE IF NOT EXISTS character_tags (
      character_id BIGINT NOT NULL,
      tag_id BIGINT NOT NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (character_id, tag_id),
      INDEX idx_character_tags_tag (tag_id, character_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await query(`CREATE TABLE IF NOT EXISTS import_batches (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      admin_user_id BIGINT NULL,
      total_count INT NOT NULL DEFAULT 0,
      success_count INT NOT NULL DEFAULT 0,
      failed_count INT NOT NULL DEFAULT 0,
      skipped_count INT NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      options_json JSON NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await query(`CREATE TABLE IF NOT EXISTS import_items (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      batch_id BIGINT NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_hash VARCHAR(64) NULL,
      status VARCHAR(30) NOT NULL,
      error_message TEXT NULL,
      parsed_role_name VARCHAR(100) NULL,
      created_role_id BIGINT NULL,
      raw_json JSON NULL,
      created_at DATETIME NOT NULL,
      INDEX idx_import_items_batch (batch_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    return;
  }

  const sqliteColumns = [
    ['avatar_image_path', 'TEXT NULL'],
    ['background_image_path', 'TEXT NULL'],
    ['is_nsfw', 'INTEGER NOT NULL DEFAULT 0'],
    ['source_type', 'TEXT NULL'],
    ['source_format', 'TEXT NULL'],
    ['source_file_name', 'TEXT NULL'],
    ['source_file_hash', 'TEXT NULL'],
    ['source_card_json', 'TEXT NULL'],
    ['imported_world_book_json', 'TEXT NULL'],
    ['flattened_world_book_text', 'TEXT NULL'],
    ['import_batch_id', 'INTEGER NULL'],
  ];
  for (const [column, definition] of sqliteColumns) {
    // eslint-disable-next-line no-await-in-loop
    await query(`ALTER TABLE characters ADD COLUMN ${column} ${definition}`).catch((error) => {
      if (!/duplicate column|already exists/i.test(String(error?.message || ''))) throw error;
    });
  }
  await query('ALTER TABLE users ADD COLUMN show_nsfw INTEGER NOT NULL DEFAULT 0').catch((error) => {
    if (!/duplicate column|already exists/i.test(String(error?.message || ''))) throw error;
  });
  await query(`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NULL,
    color TEXT NULL,
    icon TEXT NULL,
    is_nsfw INTEGER NOT NULL DEFAULT 0,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await query('CREATE INDEX IF NOT EXISTS idx_characters_source_file_hash ON characters (source_file_hash)');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_tags_slug ON tags (slug)');
  await query(`CREATE TABLE IF NOT EXISTS character_tags (
    character_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (character_id, tag_id)
  )`);
  await query('CREATE INDEX IF NOT EXISTS idx_character_tags_tag ON character_tags (tag_id, character_id)');
  await query(`CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NULL,
    total_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    options_json TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await query(`CREATE TABLE IF NOT EXISTS import_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    file_hash TEXT NULL,
    status TEXT NOT NULL,
    error_message TEXT NULL,
    parsed_role_name TEXT NULL,
    created_role_id INTEGER NULL,
    raw_json TEXT NULL,
    created_at TEXT NOT NULL
  )`);
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
