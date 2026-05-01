/**
 * @file src/lib/sqlite-schema/prompts-notifications.js
 * @description 系统提示词片段、站内通知与客服入口表结构。
 */

'use strict';

function ensureSqlitePromptNotificationSchema(db) {
// ─── 系统提示词片段表 ─────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_prompt_blocks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      block_key   TEXT NOT NULL,
      block_value TEXT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_enabled  INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_prompt_blocks_sort ON system_prompt_blocks (sort_order, id)');



  // ─── 站内通知与客服入口表 ─────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      notification_type TEXT NOT NULL DEFAULT 'general',
      audience TEXT NOT NULL DEFAULT 'all',
      display_position TEXT NOT NULL DEFAULT 'modal',
      display_duration_ms INTEGER NOT NULL DEFAULT 0,
      force_display INTEGER NOT NULL DEFAULT 0,
      show_once INTEGER NOT NULL DEFAULT 0,
      new_user_only INTEGER NOT NULL DEFAULT 0,
      support_qr_url TEXT NULL,
      action_label TEXT NULL,
      action_url TEXT NULL,
      starts_at TEXT NULL,
      ends_at TEXT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_active_window ON notifications (is_active, starts_at, ends_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_audience ON notifications (audience, notification_type)');
}

module.exports = { ensureSqlitePromptNotificationSchema };
