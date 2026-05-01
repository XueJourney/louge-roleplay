/**
 * @file src/lib/sqlite-schema/plans.js
 * @description 套餐表结构与模型权益字段补列。
 */

'use strict';


function ensureSqliteColumn(db, tableName, columnName, definitionSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => String(column.name || '').trim() === columnName);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
  }
}

function ensureSqlitePlansSchema(db) {
// ─── 套餐表 ──────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      code             TEXT NOT NULL,
      name             TEXT NOT NULL,
      description      TEXT NULL,
      billing_mode     TEXT NOT NULL DEFAULT 'per_request',
      quota_period     TEXT NOT NULL DEFAULT 'monthly',
      request_quota    INTEGER NOT NULL DEFAULT 0,
      token_quota      INTEGER NOT NULL DEFAULT 0,
      priority_weight  INTEGER NOT NULL DEFAULT 0,
      concurrency_limit INTEGER NOT NULL DEFAULT 1,
      max_output_tokens INTEGER NOT NULL DEFAULT 2048,
      plan_models_json TEXT NULL,
      status           TEXT NOT NULL DEFAULT 'active',
      is_default       INTEGER NOT NULL DEFAULT 0,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    )
  `);
  ensureSqliteColumn(db, 'plans', 'quota_period', "quota_period TEXT NOT NULL DEFAULT 'monthly'");
  ensureSqliteColumn(db, 'plans', 'plan_models_json', 'plan_models_json TEXT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_plans_code ON plans (code)');
}

module.exports = { ensureSqlitePlansSchema };
