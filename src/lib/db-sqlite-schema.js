/**
 * @file src/lib/db-sqlite-schema.js
 * @description
 * SQLite 数据库表结构初始化脚本。
 * 在 db.js 探测到 SQLite 模式且数据库文件为首次创建时自动调用。
 *
 * 与 MySQL（scripts/init-db.js）的主要差异：
 *   - BIGINT → INTEGER（SQLite 内部统一用 64 位整数）
 *   - VARCHAR/ENUM/JSON → TEXT
 *   - DATETIME → TEXT（存储格式：'YYYY-MM-DD HH:MM:SS'，与 NOW() 自定义函数一致）
 *   - DECIMAL → REAL
 *   - AUTO_INCREMENT → AUTOINCREMENT
 *   - 移除 ENGINE、CHARSET、COLLATE 等 MySQL 专属语句
 *   - 移除 CONSTRAINT FOREIGN KEY（SQLite 支持但默认不强制；PRAGMA foreign_keys=ON 由 db.js 设置）
 *   - 移除内联 INDEX（改为单独的 CREATE INDEX 语句）
 *
 * 注意：所有 NOW() 调用依赖 db.js 中注册的同名自定义函数。
 *
 * @param {import('node:sqlite').DatabaseSync} db - 已打开的 SQLite 数据库实例
 */

'use strict';

const config = require('../config');
const crypto = require('node:crypto');

/**
 * 对 API Key 进行简单遮盖，避免明文记录到数据库展示层。
 *
 * @param {string} apiKey
 * @returns {string}
 */
function maskApiKey(apiKey = '') {
  const raw = String(apiKey || '').trim();
  if (!raw) return '';
  if (raw.length <= 8) return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

function buildLegacyPlanModelsJson(provider = {}) {
  const entries = [
    ['standard', '标准模型', provider.standard_model || provider.model],
    ['jailbreak', '破限模型', provider.jailbreak_model || provider.standard_model || provider.model],
    ['force_jailbreak', '强破限模型', provider.force_jailbreak_model || provider.jailbreak_model || provider.standard_model || provider.model],
  ];
  const seen = new Set();
  return JSON.stringify(entries
    .map(([modelKey, label, modelId], index) => ({
      modelKey,
      label,
      providerId: provider.id,
      modelId: String(modelId || '').trim(),
      requestMultiplier: 1,
      tokenMultiplier: 1,
      isDefault: index === 0,
      sortOrder: index * 10,
    }))
    .filter((item) => {
      if (!item.modelId || seen.has(item.modelKey)) return false;
      seen.add(item.modelKey);
      return true;
    }));
}

/**
 * 初始化 SQLite 数据库表结构，并写入种子数据（套餐、默认 LLM 提供商）。
 * 所有 CREATE TABLE 使用 IF NOT EXISTS，可以安全重复调用。
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
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

function ensureSqliteUniqueIndex(db, indexName, tableName, columnName, whereSql = '') {
  const indexes = db.prepare(`PRAGMA index_list(${tableName})`).all();
  const hasIndex = indexes.some((index) => String(index.name || '').trim() === indexName);
  if (!hasIndex) {
    db.exec(`CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${columnName}) ${whereSql}`.trim());
  }
}

function getRandomDigitsForSqliteBackfill(length) {
  let value = String(crypto.randomInt(1, 10));
  while (value.length < length) {
    value += String(crypto.randomInt(0, 10));
  }
  return value;
}

function backfillSqliteUserPublicIds(db) {
  const users = db.prepare('SELECT id FROM users WHERE public_id IS NULL OR public_id = ? ORDER BY id ASC').all('');
  if (!users.length) {
    return;
  }

  const exists = (candidate) => {
    const row = db.prepare('SELECT id FROM users WHERE public_id = ? LIMIT 1').get(candidate);
    return Boolean(row);
  };
  const update = db.prepare('UPDATE users SET public_id = ?, updated_at = COALESCE(updated_at, NOW()) WHERE id = ?');

  const digits = 3;
  const maxRandomAttempts = 200;

  for (const user of users) {
    let publicId = '';
    for (let length = digits; !publicId; length += 1) {
      for (let attempt = 0; attempt < maxRandomAttempts; attempt += 1) {
        const candidate = getRandomDigitsForSqliteBackfill(length);
        if (!exists(candidate)) {
          publicId = candidate;
          break;
        }
      }
    }
    update.run(publicId, user.id);
  }
}

function initSqliteSchema(db) {
  // ─── 用户表 ──────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id    TEXT NULL,
      username     TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      nickname     TEXT NULL,
      email        TEXT NULL,
      phone        TEXT NULL,
      country_type TEXT NOT NULL DEFAULT 'domestic',
      email_verified INTEGER NOT NULL DEFAULT 0,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      role         TEXT NOT NULL DEFAULT 'user',
      status       TEXT NOT NULL DEFAULT 'active',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    )
  `);
  ensureSqliteColumn(db, 'users', 'public_id', 'public_id TEXT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_username ON users (username)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email ON users (email) WHERE email IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_phone ON users (phone) WHERE phone IS NOT NULL');
  backfillSqliteUserPublicIds(db);
  ensureSqliteUniqueIndex(db, 'uniq_users_public_id', 'users', 'public_id', 'WHERE public_id IS NOT NULL');

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

  // ─── 默认套餐种子数据 ─────────────────────────────────────────────────────────
  const planCount = db.prepare('SELECT COUNT(*) AS cnt FROM plans').get();
  if (Number(planCount.cnt || 0) === 0) {
    db.exec(`
      INSERT INTO plans (
        code, name, description, billing_mode, quota_period, request_quota, token_quota,
        priority_weight, concurrency_limit, max_output_tokens, status, is_default, sort_order,
        created_at, updated_at
      ) VALUES
      ('free',  '免费版', '适合体验产品基础能力',     'per_request', 'daily',   200,   200000,  10, 1, 1024, 'active', 1, 10, NOW(), NOW()),
      ('basic', '基础版', '按次/按量都可承接的主力套餐', 'hybrid',      'monthly', 3000,  3000000, 30, 2, 2048, 'active', 0, 20, NOW(), NOW()),
      ('pro',   '高级版', '更高优先级与更稳定的排队保障', 'per_token',   'monthly', 10000, 12000000,80, 3, 4096, 'active', 0, 30, NOW(), NOW())
    `);
  }

  // ─── 默认 LLM 提供商（仅当 ENV 中配置了 Key 时写入）─────────────────────────
  const providerCount = db.prepare('SELECT COUNT(*) AS cnt FROM llm_providers').get();
  if (
    Number(providerCount.cnt || 0) === 0
    && config.openaiBaseUrl
    && config.openaiApiKey
    && config.openaiModel
  ) {
    const masked = maskApiKey(config.openaiApiKey);
    const models = JSON.stringify([config.openaiModel]);
    db.prepare(`
      INSERT INTO llm_providers (
        name, provider_type, base_url, api_key, api_key_masked, model,
        standard_model, jailbreak_model, force_jailbreak_model, compression_model,
        available_models_json, max_context_tokens, trim_context_tokens,
        is_active, status, max_concurrency, timeout_ms,
        input_token_price, output_token_price, created_at, updated_at
      ) VALUES (?, 'openai_compatible', ?, ?, ?, ?, ?, ?, ?, ?, ?, 81920, 61440, 1, 'active', 5, 60000, 0, 0, NOW(), NOW())
    `).run(
      'Default OpenAI Compatible',
      config.openaiBaseUrl,
      config.openaiApiKey,
      masked,
      config.openaiModel,
      config.openaiModel,
      config.openaiModel,
      config.openaiModel,
      config.openaiModel,
      models,
    );
  }

  const activeProviderForPlanBackfill = db.prepare(`
    SELECT id, model, standard_model, jailbreak_model, force_jailbreak_model
    FROM llm_providers
    WHERE is_active = 1 AND status = 'active'
    ORDER BY id ASC
    LIMIT 1
  `).get();
  if (activeProviderForPlanBackfill) {
    const legacyPlanModelsJson = buildLegacyPlanModelsJson(activeProviderForPlanBackfill);
    if (JSON.parse(legacyPlanModelsJson).length) {
      db.prepare("UPDATE plans SET plan_models_json = ?, updated_at = NOW() WHERE plan_models_json IS NULL OR plan_models_json = '' OR plan_models_json = '[]'").run(legacyPlanModelsJson);
    }
  }
}

module.exports = { initSqliteSchema };
