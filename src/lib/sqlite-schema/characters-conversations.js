/**
 * @file src/lib/sqlite-schema/characters-conversations.js
 * @description 角色、互动事件、会话与消息表结构。
 */

'use strict';


function ensureSqliteCharactersVisibilityColumn(db) {
  const columns = db.prepare("PRAGMA table_info(characters)").all();
  const hasVisibility = columns.some((column) => String(column.name || '').trim() === 'visibility');
  if (!hasVisibility) {
    db.exec("ALTER TABLE characters ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'");
  }
}


function ensureSqliteColumn(db, tableName, columnName, definitionSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => String(column.name || '').trim() === columnName);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
  }
}

function ensureSqliteCharacterConversationSchema(db) {
// ─── 角色表 ──────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL,
      name                TEXT NOT NULL,
      summary             TEXT NOT NULL,
      personality         TEXT NULL,
      first_message       TEXT NULL,
      prompt_profile_json TEXT NULL,
      visibility          TEXT NOT NULL DEFAULT 'public',
      status              TEXT NOT NULL DEFAULT 'published',
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    )
  `);

  // ─── 会话表 ──────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                 INTEGER NOT NULL,
      character_id            INTEGER NOT NULL,
      parent_conversation_id  INTEGER NULL,
      branched_from_message_id INTEGER NULL,
      current_message_id      INTEGER NULL,
      selected_model_mode     TEXT NOT NULL DEFAULT 'standard',
      title                   TEXT NULL,
      status                  TEXT NOT NULL DEFAULT 'active',
      deleted_at              TEXT NULL,
      last_message_at         TEXT NULL,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations (user_id, updated_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_parent ON conversations (parent_conversation_id)');

  ensureSqliteCharactersVisibilityColumn(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_character_like_user ON character_likes (character_id, user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_character_likes_character ON character_likes (character_id)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_character_comments_character ON character_comments (character_id, status, id)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_character_usage_character ON character_usage_events (character_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_character_usage_user ON character_usage_events (user_id, created_at)');
  ensureSqliteColumn(db, 'conversations', 'parent_conversation_id', 'parent_conversation_id INTEGER NULL');
  ensureSqliteColumn(db, 'conversations', 'branched_from_message_id', 'branched_from_message_id INTEGER NULL');
  ensureSqliteColumn(db, 'conversations', 'current_message_id', 'current_message_id INTEGER NULL');
  ensureSqliteColumn(db, 'conversations', 'selected_model_mode', "selected_model_mode TEXT NOT NULL DEFAULT 'standard'");
  ensureSqliteColumn(db, 'conversations', 'deleted_at', 'deleted_at TEXT NULL');
  ensureSqliteColumn(db, 'conversations', 'last_message_at', 'last_message_at TEXT NULL');

  // ─── 消息表 ──────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id       INTEGER NOT NULL,
      sender_type           TEXT NOT NULL,
      content               TEXT NOT NULL,
      sequence_no           INTEGER NOT NULL,
      parent_message_id     INTEGER NULL,
      branch_from_message_id INTEGER NULL,
      edited_from_message_id INTEGER NULL,
      prompt_kind           TEXT NOT NULL DEFAULT 'normal',
      metadata_json         TEXT NULL,
      status                TEXT NOT NULL DEFAULT 'success',
      deleted_at            TEXT NULL,
      created_at            TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, sequence_no)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages (parent_message_id)');
  ensureSqliteColumn(db, 'messages', 'deleted_at', 'deleted_at TEXT NULL');
}

module.exports = { ensureSqliteCharacterConversationSchema };
