/**
 * @file src/lib/sqlite-schema/llm.js
 * @description LLM 提供商、任务队列与用量日志 SQLite 结构。
 */

'use strict';


function ensureSqliteColumn(db, tableName, columnName, definitionSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => String(column.name || '').trim() === columnName);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
  }
}

function ensureSqliteLlmSchema(db) {
// ─── LLM 提供商表 ─────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_providers (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      name                  TEXT NOT NULL,
      provider_type         TEXT NOT NULL DEFAULT 'openai_compatible',
      base_url              TEXT NOT NULL,
      api_key               TEXT NOT NULL,
      api_key_masked        TEXT NOT NULL,
      model                 TEXT NOT NULL,
      standard_model        TEXT NOT NULL DEFAULT '',
      jailbreak_model       TEXT NOT NULL DEFAULT '',
      force_jailbreak_model TEXT NOT NULL DEFAULT '',
      compression_model     TEXT NOT NULL DEFAULT '',
      available_models_json TEXT NULL,
      max_context_tokens    INTEGER NOT NULL DEFAULT 81920,
      trim_context_tokens   INTEGER NOT NULL DEFAULT 61440,
      is_active             INTEGER NOT NULL DEFAULT 0,
      status                TEXT NOT NULL DEFAULT 'active',
      max_concurrency       INTEGER NOT NULL DEFAULT 5,
      timeout_ms            INTEGER NOT NULL DEFAULT 60000,
      input_token_price     REAL NOT NULL DEFAULT 0,
      output_token_price    REAL NOT NULL DEFAULT 0,
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL
    )
  `);
  ensureSqliteColumn(db, 'llm_providers', 'standard_model', "standard_model TEXT NOT NULL DEFAULT ''");
  ensureSqliteColumn(db, 'llm_providers', 'jailbreak_model', "jailbreak_model TEXT NOT NULL DEFAULT ''");
  ensureSqliteColumn(db, 'llm_providers', 'force_jailbreak_model', "force_jailbreak_model TEXT NOT NULL DEFAULT ''");
  ensureSqliteColumn(db, 'llm_providers', 'compression_model', "compression_model TEXT NOT NULL DEFAULT ''");
  ensureSqliteColumn(db, 'llm_providers', 'available_models_json', 'available_models_json TEXT NULL');
  ensureSqliteColumn(db, 'llm_providers', 'max_context_tokens', 'max_context_tokens INTEGER NOT NULL DEFAULT 81920');
  ensureSqliteColumn(db, 'llm_providers', 'trim_context_tokens', 'trim_context_tokens INTEGER NOT NULL DEFAULT 61440');
  ensureSqliteColumn(db, 'llm_providers', 'max_concurrency', 'max_concurrency INTEGER NOT NULL DEFAULT 5');
  ensureSqliteColumn(db, 'llm_providers', 'timeout_ms', 'timeout_ms INTEGER NOT NULL DEFAULT 60000');
  ensureSqliteColumn(db, 'llm_providers', 'input_token_price', 'input_token_price REAL NOT NULL DEFAULT 0');
  ensureSqliteColumn(db, 'llm_providers', 'output_token_price', 'output_token_price REAL NOT NULL DEFAULT 0');
  db.exec(`
    UPDATE llm_providers
    SET
      standard_model        = COALESCE(NULLIF(standard_model, ''), model),
      jailbreak_model       = COALESCE(NULLIF(jailbreak_model, ''), COALESCE(NULLIF(standard_model, ''), model)),
      force_jailbreak_model = COALESCE(NULLIF(force_jailbreak_model, ''), COALESCE(NULLIF(jailbreak_model, ''), COALESCE(NULLIF(standard_model, ''), model))),
      compression_model     = COALESCE(NULLIF(compression_model, ''), COALESCE(NULLIF(standard_model, ''), model)),
      available_models_json = CASE
        WHEN available_models_json IS NULL OR available_models_json = '' OR available_models_json = '[]'
          THEN json_array(model)
        ELSE available_models_json
      END
  `);

  // ─── LLM 任务队列表 ───────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_jobs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id      TEXT NOT NULL,
      user_id         INTEGER NOT NULL,
      conversation_id INTEGER NULL,
      provider_id     INTEGER NULL,
      priority        INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'queued',
      prompt_kind     TEXT NOT NULL DEFAULT 'chat',
      error_message   TEXT NULL,
      started_at      TEXT NULL,
      finished_at     TEXT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_llm_jobs_status ON llm_jobs (status, priority, created_at)');

  // ─── LLM 用量日志表 ───────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_usage_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id      TEXT NOT NULL,
      user_id         INTEGER NOT NULL,
      conversation_id INTEGER NULL,
      provider_id     INTEGER NULL,
      plan_id         INTEGER NULL,
      prompt_kind     TEXT NOT NULL DEFAULT 'chat',
      status          TEXT NOT NULL DEFAULT 'success',
      model_key       TEXT NULL,
      model_id        TEXT NULL,
      request_multiplier REAL NOT NULL DEFAULT 1,
      token_multiplier REAL NOT NULL DEFAULT 1,
      billable_request_units INTEGER NOT NULL DEFAULT 1,
      billable_tokens INTEGER NOT NULL DEFAULT 0,
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      total_tokens    INTEGER NOT NULL DEFAULT 0,
      total_cost      REAL NOT NULL DEFAULT 0,
      latency_ms      INTEGER NOT NULL DEFAULT 0,
      error_message   TEXT NULL,
      created_at      TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_user ON llm_usage_logs (user_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_request ON llm_usage_logs (request_id)');
  ensureSqliteColumn(db, 'llm_usage_logs', 'model_key', 'model_key TEXT NULL');
  ensureSqliteColumn(db, 'llm_usage_logs', 'model_id', 'model_id TEXT NULL');
  ensureSqliteColumn(db, 'llm_usage_logs', 'request_multiplier', 'request_multiplier REAL NOT NULL DEFAULT 1');
  ensureSqliteColumn(db, 'llm_usage_logs', 'token_multiplier', 'token_multiplier REAL NOT NULL DEFAULT 1');
  ensureSqliteColumn(db, 'llm_usage_logs', 'billable_request_units', 'billable_request_units INTEGER NOT NULL DEFAULT 1');
  ensureSqliteColumn(db, 'llm_usage_logs', 'billable_tokens', 'billable_tokens INTEGER NOT NULL DEFAULT 0');
  db.exec("UPDATE llm_usage_logs SET billable_request_units = 1 WHERE billable_request_units <= 0 AND status = 'success'");
  db.exec("UPDATE llm_usage_logs SET billable_tokens = total_tokens WHERE billable_tokens = 0 AND total_tokens > 0 AND status = 'success'");
}

module.exports = { ensureSqliteLlmSchema };
