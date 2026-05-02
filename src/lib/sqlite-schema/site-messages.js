/**
 * @file src/lib/sqlite-schema/site-messages.js
 * @description 站内信与收件人状态表结构。
 */

'use strict';

function ensureSqliteSiteMessageSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      sender_admin_user_id INTEGER NULL,
      target_mode TEXT NOT NULL DEFAULT 'all',
      filter_role TEXT NOT NULL DEFAULT 'any',
      filter_status TEXT NOT NULL DEFAULT 'any',
      filter_plan_code TEXT NULL,
      is_important INTEGER NOT NULL DEFAULT 0,
      recipient_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_message_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_site_message_recipient ON site_message_recipients (message_id, user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_site_message_recipients_user_read ON site_message_recipients (user_id, is_read, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_site_messages_created ON site_messages (created_at)');
}

module.exports = { ensureSqliteSiteMessageSchema };
