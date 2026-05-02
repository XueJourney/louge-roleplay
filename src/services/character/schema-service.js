/**
 * @file src/services/character/schema-service.js
 * @description 角色相关表结构的启动期自修复。
 */

const { query, getDbType } = require('../../lib/db');
const { MAX_CHARACTER_FIELD_LENGTH } = require('../../constants/character-limits');

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

async function ensureMysqlCharacterSchema() {
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
  await ensureMysqlColumn('users', 'reply_length_preference', "`reply_length_preference` ENUM('low','medium','high') NOT NULL DEFAULT 'medium'");
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
}

async function ensureSqliteCharacterSchema() {
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

async function ensureCharacterImageColumns() {
  if (getDbType() === 'mysql') {
    await ensureMysqlCharacterSchema();
    return;
  }
  await ensureSqliteCharacterSchema();
}

module.exports = {
  ensureCharacterImageColumns,
};
