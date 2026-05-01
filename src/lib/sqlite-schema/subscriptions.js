/**
 * @file src/lib/sqlite-schema/subscriptions.js
 * @description 用户订阅表结构与用户状态索引。
 */

'use strict';

function ensureSqliteSubscriptionsSchema(db) {
// ─── 用户订阅表 ───────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      plan_id    INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL,
      ended_at   TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_status ON user_subscriptions (user_id, status)');
}

module.exports = { ensureSqliteSubscriptionsSchema };
