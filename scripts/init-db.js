/**
 * @file scripts/init-db.js
 * @description
 * 数据库初始化脚本。根据当前配置自动选择初始化策略：
 *
 *   MySQL 模式（DATABASE_URL 已设置）：
 *     - 使用 DATABASE_ADMIN_URL 创建数据库（若不存在）
 *     - 创建全部业务表并补全历史缺失字段/索引（幂等，可反复执行）
 *     - 写入默认套餐与 LLM 提供商种子数据
 *
 *   SQLite 模式（DATABASE_URL 未设置）：
 *     - 表结构由 db.js 在首次连接时自动初始化，此脚本无需额外操作
 *     - 数据库文件路径：<项目根>/data/local.db
 *
 * 使用方式：
 *   npm run db:init
 *   或
 *   node scripts/init-db.js
 */

'use strict';

const mysql = require('mysql2/promise');
const crypto = require('node:crypto');
const config = require('../src/config');

function getDatabaseNameFromUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || '').trim();
    if (!databaseName) {
      throw new Error('DATABASE_URL must include a database name');
    }
    if (!/^[A-Za-z0-9_$-]+$/.test(databaseName)) {
      throw new Error(`Unsupported database name: ${databaseName}`);
    }
    return databaseName;
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL: ${error.message}`);
  }
}

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, '``')}\``;
}

/**
 * 对 API Key 进行遮盖，避免明文写入数据库展示层。
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

function getRandomDigits(length) {
  let value = String(crypto.randomInt(1, 10));
  while (value.length < length) {
    value += String(crypto.randomInt(0, 10));
  }
  return value;
}

async function backfillUserPublicIds(connection) {
  const [users] = await connection.query("SELECT id FROM users WHERE public_id IS NULL OR public_id = '' ORDER BY id ASC");
  if (!users.length) {
    return;
  }

  const exists = async (candidate) => {
    const [rows] = await connection.query('SELECT id FROM users WHERE public_id = ? LIMIT 1', [candidate]);
    return rows.length > 0;
  };

  for (const user of users) {
    let publicId = '';
    for (let digits = 3; !publicId; digits += 1) {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const candidate = getRandomDigits(digits);
        // eslint-disable-next-line no-await-in-loop
        if (!(await exists(candidate))) {
          publicId = candidate;
          break;
        }
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await connection.query('UPDATE users SET public_id = ?, updated_at = NOW() WHERE id = ?', [publicId, user.id]);
  }

  console.log(`[init-db]   + 已为 ${users.length} 个历史用户补齐公开 ID`);
}

// ─── SQLite 模式：提示并退出 ──────────────────────────────────────────────────

if (!config.databaseUrl) {
  console.log('');
  console.log('[init-db] DATABASE_URL 未设置 → SQLite 模式');
  console.log('[init-db] SQLite 表结构将在应用首次启动时自动初始化（data/local.db）。');
  console.log('[init-db] 你现在可以直接运行 npm start 或 npm run dev。');
  console.log('');
  process.exit(0);
}

// ─── MySQL 模式：完整初始化 ───────────────────────────────────────────────────

async function main() {
  if (!config.databaseAdminUrl) {
    throw new Error('DATABASE_ADMIN_URL is required for MySQL mode (needed to CREATE DATABASE)');
  }

  console.log('[init-db] 开始 MySQL 数据库初始化...');
  const databaseName = getDatabaseNameFromUrl(config.databaseUrl);

  // 1. 用管理员连接创建 DATABASE_URL 指向的数据库（若不存在）
  const adminConnection = await mysql.createConnection(config.databaseAdminUrl);
  await adminConnection.query(
    `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(databaseName)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await adminConnection.end();
  console.log(`[init-db] 数据库 ${databaseName} 已就绪`);

  // 2. 使用业务连接创建/更新表结构
  const connection = await mysql.createConnection(config.databaseUrl);

  // ── 辅助函数：幂等添加列 / 索引 ─────────────────────────────────────────────

  /**
   * 若列不存在则添加。
   * @param {string} tableName
   * @param {string} columnName
   * @param {string} definitionSql  列定义（不含列名）
   */
  async function ensureColumn(tableName, columnName, definitionSql) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName],
    );
    if (Number(rows[0].count || 0) === 0) {
      await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definitionSql}`);
      console.log(`[init-db]   + 列 ${tableName}.${columnName}`);
    }
  }

  /**
   * 若普通索引不存在则添加。
   * @param {string} tableName
   * @param {string} indexName
   * @param {string} columnsSql  如 "(col1, col2)"
   */
  async function ensureIndex(tableName, indexName, columnsSql) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [tableName, indexName],
    );
    if (Number(rows[0].count || 0) === 0) {
      await connection.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` ${columnsSql}`);
      console.log(`[init-db]   + 索引 ${tableName}.${indexName}`);
    }
  }

  /**
   * 若唯一索引不存在则添加。
   * @param {string} tableName
   * @param {string} indexName
   * @param {string} columnName
   */
  async function ensureUniqueIndex(tableName, indexName, columnName) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [tableName, indexName],
    );
    if (Number(rows[0].count || 0) === 0) {
      await connection.query(
        `ALTER TABLE \`${tableName}\` ADD UNIQUE INDEX \`${indexName}\` (${columnName})`,
      );
      console.log(`[init-db]   + 唯一索引 ${tableName}.${indexName}`);
    }
  }

  // ── 用户表 ───────────────────────────────────────────────────────────────────
  console.log('[init-db] 初始化 users 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            BIGINT PRIMARY KEY AUTO_INCREMENT,
      public_id     VARCHAR(32) NULL,
      username      VARCHAR(50) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      nickname      VARCHAR(80) NULL,
      email         VARCHAR(120) NULL,
      phone         VARCHAR(30) NULL,
      country_type  ENUM('domestic','international') NOT NULL DEFAULT 'domestic',
      email_verified TINYINT(1) NOT NULL DEFAULT 0,
      phone_verified TINYINT(1) NOT NULL DEFAULT 0,
      role          ENUM('user','admin') NOT NULL DEFAULT 'user',
      status        ENUM('active','blocked') NOT NULL DEFAULT 'active',
      created_at    DATETIME NOT NULL,
      updated_at    DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn('users', 'public_id',      'public_id VARCHAR(32) NULL AFTER id');
  await ensureColumn('users', 'email',          'email VARCHAR(120) NULL');
  await ensureColumn('users', 'phone',          'phone VARCHAR(30) NULL');
  await ensureColumn('users', 'country_type',   "country_type ENUM('domestic','international') NOT NULL DEFAULT 'domestic'");
  await ensureColumn('users', 'email_verified', 'email_verified TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('users', 'phone_verified', 'phone_verified TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('users', 'role',           "role ENUM('user','admin') NOT NULL DEFAULT 'user'");
  await ensureColumn('users', 'status',         "status ENUM('active','blocked') NOT NULL DEFAULT 'active'");
  await ensureUniqueIndex('users', 'uniq_users_email', 'email');
  await ensureUniqueIndex('users', 'uniq_users_phone', 'phone');
  await backfillUserPublicIds(connection);
  await ensureUniqueIndex('users', 'uniq_users_public_id', 'public_id');

  // ── 套餐表 ───────────────────────────────────────────────────────────────────
  console.log('[init-db] 初始化 plans 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id               BIGINT PRIMARY KEY AUTO_INCREMENT,
      code             VARCHAR(50) NOT NULL UNIQUE,
      name             VARCHAR(100) NOT NULL,
      description      VARCHAR(255) NULL,
      billing_mode     ENUM('per_request','per_token','hybrid') NOT NULL DEFAULT 'per_request',
      request_quota    INT NOT NULL DEFAULT 0,
      token_quota      BIGINT NOT NULL DEFAULT 0,
      priority_weight  INT NOT NULL DEFAULT 0,
      concurrency_limit INT NOT NULL DEFAULT 1,
      max_output_tokens INT NOT NULL DEFAULT 2048,
      plan_models_json LONGTEXT NULL,
      status           ENUM('active','archived') NOT NULL DEFAULT 'active',
      is_default       TINYINT(1) NOT NULL DEFAULT 0,
      sort_order       INT NOT NULL DEFAULT 0,
      created_at       DATETIME NOT NULL,
      updated_at       DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn('plans', 'quota_period', "quota_period ENUM('daily','monthly','lifetime') NOT NULL DEFAULT 'monthly'");
  await ensureColumn('plans', 'plan_models_json', 'plan_models_json LONGTEXT NULL');
  await connection.query(`
    ALTER TABLE \`plans\`
    MODIFY COLUMN \`billing_mode\` ENUM('per_request','per_token','hybrid') NOT NULL DEFAULT 'per_request'
  `);

  // ── 用户订阅表 ───────────────────────────────────────────────────────────────
  console.log('[init-db] 初始化 user_subscriptions 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id         BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id    BIGINT NOT NULL,
      plan_id    BIGINT NOT NULL,
      status     ENUM('active','expired','cancelled') NOT NULL DEFAULT 'active',
      started_at DATETIME NOT NULL,
      ended_at   DATETIME NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      CONSTRAINT fk_user_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT,
      INDEX idx_user_subscriptions_user_status (user_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── LLM 提供商表 ─────────────────────────────────────────────────────────────
  console.log('[init-db] 初始化 llm_providers 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS llm_providers (
      id                    BIGINT PRIMARY KEY AUTO_INCREMENT,
      name                  VARCHAR(100) NOT NULL,
      provider_type         ENUM('openai_compatible') NOT NULL DEFAULT 'openai_compatible',
      base_url              VARCHAR(255) NOT NULL,
      api_key               VARCHAR(255) NOT NULL,
      api_key_masked        VARCHAR(64) NOT NULL,
      model                 VARCHAR(100) NOT NULL,
      standard_model        VARCHAR(160) NOT NULL DEFAULT '',
      jailbreak_model       VARCHAR(160) NOT NULL DEFAULT '',
      force_jailbreak_model VARCHAR(160) NOT NULL DEFAULT '',
      compression_model     VARCHAR(160) NOT NULL DEFAULT '',
      max_context_tokens    INT NOT NULL DEFAULT 81920,
      trim_context_tokens   INT NOT NULL DEFAULT 61440,
      is_active             TINYINT(1) NOT NULL DEFAULT 0,
      status                ENUM('active','disabled') NOT NULL DEFAULT 'active',
      max_concurrency       INT NOT NULL DEFAULT 5,
      timeout_ms            INT NOT NULL DEFAULT 60000,
      created_at            DATETIME NOT NULL,
      updated_at            DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn('llm_providers', 'available_models_json',  'available_models_json LONGTEXT NULL');
  await ensureColumn('llm_providers', 'standard_model',         "standard_model VARCHAR(160) NOT NULL DEFAULT ''");
  await ensureColumn('llm_providers', 'jailbreak_model',        "jailbreak_model VARCHAR(160) NOT NULL DEFAULT ''");
  await ensureColumn('llm_providers', 'force_jailbreak_model',  "force_jailbreak_model VARCHAR(160) NOT NULL DEFAULT ''");
  await ensureColumn('llm_providers', 'compression_model',      "compression_model VARCHAR(160) NOT NULL DEFAULT ''");
  await ensureColumn('llm_providers', 'max_context_tokens',     'max_context_tokens INT NOT NULL DEFAULT 81920');
  await ensureColumn('llm_providers', 'trim_context_tokens',    'trim_context_tokens INT NOT NULL DEFAULT 61440');
  await ensureColumn('llm_providers', 'input_token_price',      'input_token_price DECIMAL(12,6) NOT NULL DEFAULT 0');
  await ensureColumn('llm_providers', 'output_token_price',     'output_token_price DECIMAL(12,6) NOT NULL DEFAULT 0');

  // 将旧的 model 字段数据迁移到各模式专用字段
  await connection.query(`
    UPDATE llm_providers
    SET
      standard_model        = COALESCE(NULLIF(standard_model, ''),        model),
      jailbreak_model       = COALESCE(NULLIF(jailbreak_model, ''),       COALESCE(NULLIF(standard_model, ''), model)),
      force_jailbreak_model = COALESCE(NULLIF(force_jailbreak_model, ''), COALESCE(NULLIF(jailbreak_model, ''), COALESCE(NULLIF(standard_model, ''), model))),
      compression_model     = COALESCE(NULLIF(compression_model, ''),     COALESCE(NULLIF(standard_model, ''), model)),
      max_context_tokens    = IFNULL(NULLIF(max_context_tokens, 0), 81920),
      trim_context_tokens   = IFNULL(NULLIF(trim_context_tokens, 0), 61440)
  `);

  // ── LLM 任务表 ───────────────────────────────────────────────────────────────
  console.log('[init-db] 初始化 llm_jobs 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS llm_jobs (
      id              BIGINT PRIMARY KEY AUTO_INCREMENT,
      request_id      VARCHAR(64) NOT NULL,
      user_id         BIGINT NOT NULL,
      conversation_id BIGINT NULL,
      provider_id     BIGINT NULL,
      priority        INT NOT NULL DEFAULT 0,
      status          ENUM('queued','running','success','failed') NOT NULL DEFAULT 'queued',
      prompt_kind     VARCHAR(32) NOT NULL DEFAULT 'chat',
      error_message   VARCHAR(255) NULL,
      started_at      DATETIME NULL,
      finished_at     DATETIME NULL,
      created_at      DATETIME NOT NULL,
      updated_at      DATETIME NOT NULL,
      CONSTRAINT fk_llm_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_llm_jobs_status_priority (status, priority, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── LLM 用量日志表 ────────────────────────────────────────────────────────────
  console.log('[init-db] 初始化 llm_usage_logs 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS llm_usage_logs (
      id              BIGINT PRIMARY KEY AUTO_INCREMENT,
      request_id      VARCHAR(64) NOT NULL,
      user_id         BIGINT NOT NULL,
      conversation_id BIGINT NULL,
      provider_id     BIGINT NULL,
      plan_id         BIGINT NULL,
      prompt_kind     VARCHAR(32) NOT NULL DEFAULT 'chat',
      status          ENUM('success','failed') NOT NULL DEFAULT 'success',
      model_key       VARCHAR(64) NULL,
      model_id        VARCHAR(160) NULL,
      request_multiplier DECIMAL(8,2) NOT NULL DEFAULT 1,
      token_multiplier DECIMAL(8,2) NOT NULL DEFAULT 1,
      billable_request_units INT NOT NULL DEFAULT 1,
      billable_tokens BIGINT NOT NULL DEFAULT 0,
      input_tokens    INT NOT NULL DEFAULT 0,
      output_tokens   INT NOT NULL DEFAULT 0,
      total_tokens    INT NOT NULL DEFAULT 0,
      total_cost      DECIMAL(12,6) NOT NULL DEFAULT 0,
      latency_ms      INT NOT NULL DEFAULT 0,
      error_message   VARCHAR(255) NULL,
      created_at      DATETIME NOT NULL,
      CONSTRAINT fk_llm_usage_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_llm_usage_logs_user_created (user_id, created_at),
      INDEX idx_llm_usage_logs_request_id (request_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn('llm_usage_logs', 'model_key', 'model_key VARCHAR(64) NULL');
  await ensureColumn('llm_usage_logs', 'model_id', 'model_id VARCHAR(160) NULL');
  await ensureColumn('llm_usage_logs', 'request_multiplier', 'request_multiplier DECIMAL(8,2) NOT NULL DEFAULT 1');
  await ensureColumn('llm_usage_logs', 'token_multiplier', 'token_multiplier DECIMAL(8,2) NOT NULL DEFAULT 1');
  await ensureColumn('llm_usage_logs', 'billable_request_units', 'billable_request_units INT NOT NULL DEFAULT 1');
  await ensureColumn('llm_usage_logs', 'billable_tokens', 'billable_tokens BIGINT NOT NULL DEFAULT 0');
  await connection.query('UPDATE llm_usage_logs SET billable_request_units = 1 WHERE billable_request_units <= 0 AND status = \'success\'');
  await connection.query('UPDATE llm_usage_logs SET billable_tokens = total_tokens WHERE billable_tokens = 0 AND total_tokens > 0 AND status = \'success\'');

  // ── 系统提示词表 ─────────────────────────────────────────────────────────────
  console.log('[init-db] 初始化 system_prompt_blocks 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS system_prompt_blocks (
      id          BIGINT PRIMARY KEY AUTO_INCREMENT,
      block_key   VARCHAR(120) NOT NULL,
      block_value LONGTEXT NULL,
      sort_order  INT NOT NULL DEFAULT 0,
      is_enabled  TINYINT(1) NOT NULL DEFAULT 1,
      created_at  DATETIME NOT NULL,
      updated_at  DATETIME NOT NULL,
      INDEX idx_system_prompt_blocks_sort (sort_order, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);



  // ── 站内通知与客服入口表 ─────────────────────────────────────────────────────
  console.log('[init-db] 初始化 notifications 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(120) NOT NULL,
      body TEXT NOT NULL,
      notification_type ENUM('general','new_user','support','error','maintenance') NOT NULL DEFAULT 'general',
      audience ENUM('all','guest','user','admin') NOT NULL DEFAULT 'all',
      display_position ENUM('modal','toast','banner') NOT NULL DEFAULT 'modal',
      display_duration_ms INT NOT NULL DEFAULT 0,
      force_display TINYINT(1) NOT NULL DEFAULT 0,
      show_once TINYINT(1) NOT NULL DEFAULT 0,
      new_user_only TINYINT(1) NOT NULL DEFAULT 0,
      support_qr_url VARCHAR(500) NULL,
      action_label VARCHAR(80) NULL,
      action_url VARCHAR(500) NULL,
      starts_at DATETIME NULL,
      ends_at DATETIME NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      priority INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_notifications_active_window (is_active, starts_at, ends_at),
      INDEX idx_notifications_audience (audience, notification_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 角色表 ───────────────────────────────────────────────────────────────────
  console.log('[init-db] 初始化 characters 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS characters (
      id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id             BIGINT NOT NULL,
      name                VARCHAR(100) NOT NULL,
      summary             VARCHAR(500) NOT NULL,
      personality         TEXT NULL,
      first_message       TEXT NULL,
      prompt_profile_json JSON NULL,
      visibility          ENUM('public','private','unlisted') DEFAULT 'public',
      status              ENUM('draft','published','blocked') DEFAULT 'published',
      created_at          DATETIME NOT NULL,
      updated_at          DATETIME NOT NULL,
      CONSTRAINT fk_characters_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn('characters', 'prompt_profile_json', 'prompt_profile_json JSON NULL');
  await ensureColumn('characters', 'visibility', "visibility ENUM('public','private','unlisted') DEFAULT 'public'");

  await connection.query(`
    ALTER TABLE \`characters\`
    MODIFY COLUMN \`visibility\`
      ENUM('public','private','unlisted')
      NOT NULL DEFAULT 'public'
  `);
  console.log('[init-db]   ~ characters.visibility ENUM 已确认完整');

  // ── 角色公开互动表 ─────────────────────────────────────────────────────────────
  console.log('[init-db] 初始化 character_likes / comments / usage 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS character_likes (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      character_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      created_at DATETIME NOT NULL,
      UNIQUE KEY uniq_character_like_user (character_id, user_id),
      INDEX idx_character_likes_character (character_id),
      CONSTRAINT fk_character_likes_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT fk_character_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS character_comments (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      character_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      body VARCHAR(500) NOT NULL,
      status ENUM('visible','hidden','deleted') NOT NULL DEFAULT 'visible',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_character_comments_character (character_id, status, id),
      CONSTRAINT fk_character_comments_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT fk_character_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS character_usage_events (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      character_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      created_at DATETIME NOT NULL,
      INDEX idx_character_usage_character (character_id),
      INDEX idx_character_usage_user (user_id, created_at),
      CONSTRAINT fk_character_usage_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      CONSTRAINT fk_character_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 会话表 ───────────────────────────────────────────────────────────────────
  console.log('[init-db] 初始化 conversations 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id                       BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id                  BIGINT NOT NULL,
      character_id             BIGINT NOT NULL,
      parent_conversation_id   BIGINT NULL,
      branched_from_message_id BIGINT NULL,
      current_message_id       BIGINT NULL,
      selected_model_mode      VARCHAR(64) NOT NULL DEFAULT 'standard',
      title                    VARCHAR(200) NULL,
      status                   ENUM('active','archived','deleted') DEFAULT 'active',
      deleted_at               DATETIME NULL,
      last_message_at          DATETIME NULL,
      created_at               DATETIME NOT NULL,
      updated_at               DATETIME NOT NULL,
      CONSTRAINT fk_conversations_user      FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE,
      CONSTRAINT fk_conversations_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn('conversations', 'parent_conversation_id',   'parent_conversation_id BIGINT NULL');
  await ensureColumn('conversations', 'branched_from_message_id', 'branched_from_message_id BIGINT NULL');
  await ensureColumn('conversations', 'current_message_id',       'current_message_id BIGINT NULL');
  await ensureColumn('conversations', 'selected_model_mode',      "selected_model_mode VARCHAR(64) NOT NULL DEFAULT 'standard'");
  await connection.query(`
    ALTER TABLE \`conversations\`
    MODIFY COLUMN \`selected_model_mode\` VARCHAR(64) NOT NULL DEFAULT 'standard'
  `);
  await ensureColumn('conversations', 'deleted_at',               'deleted_at DATETIME NULL');
  await ensureIndex('conversations', 'idx_conversations_parent',         '(parent_conversation_id)');
  await ensureIndex('conversations', 'idx_conversations_branch_message', '(branched_from_message_id)');
  await ensureIndex('conversations', 'idx_conversations_current_message','(current_message_id)');

  // ── 消息表 ───────────────────────────────────────────────────────────────────
  console.log('[init-db] 初始化 messages 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id                     BIGINT PRIMARY KEY AUTO_INCREMENT,
      conversation_id        BIGINT NOT NULL,
      sender_type            ENUM('user','character','system') NOT NULL,
      content                LONGTEXT NOT NULL,
      sequence_no            INT NOT NULL,
      parent_message_id      BIGINT NULL,
      branch_from_message_id BIGINT NULL,
      edited_from_message_id BIGINT NULL,
      prompt_kind            ENUM('normal','regenerate','branch','edit','optimized','replay','conversation-start','first-message') NOT NULL DEFAULT 'normal',
      metadata_json          JSON NULL,
      status                 ENUM('success','failed','streaming') DEFAULT 'success',
      deleted_at             DATETIME NULL,
      created_at             DATETIME NOT NULL,
      CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      INDEX idx_messages_conversation_sequence (conversation_id, sequence_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn('messages', 'parent_message_id',      'parent_message_id BIGINT NULL');
  await ensureColumn('messages', 'branch_from_message_id', 'branch_from_message_id BIGINT NULL');
  await ensureColumn('messages', 'edited_from_message_id', 'edited_from_message_id BIGINT NULL');
  await ensureColumn('messages', 'prompt_kind',
    "prompt_kind ENUM('normal','regenerate','branch','edit','optimized','replay','conversation-start','first-message') NOT NULL DEFAULT 'normal'");
  await ensureColumn('messages', 'metadata_json', 'metadata_json JSON NULL');
  await ensureColumn('messages', 'deleted_at', 'deleted_at DATETIME NULL');
  await ensureIndex('messages', 'idx_messages_parent',      '(parent_message_id)');
  await ensureIndex('messages', 'idx_messages_branch_from', '(branch_from_message_id)');
  await ensureIndex('messages', 'idx_messages_edited_from', '(edited_from_message_id)');

  // 无条件扩展 prompt_kind ENUM：ensureColumn 只添加列不修改已有列的类型，
  // 若服务器由中间版本初始化导致 ENUM 值不完整，此语句确保所有新值可写入。
  // MODIFY COLUMN 在 MySQL 中幂等，重复执行无副作用。
  await connection.query(`
    ALTER TABLE \`messages\`
    MODIFY COLUMN \`prompt_kind\`
      ENUM('normal','regenerate','branch','edit','optimized','replay','conversation-start','first-message')
      NOT NULL DEFAULT 'normal'
  `);
  console.log('[init-db]   ~ messages.prompt_kind ENUM 已确认完整');

  // ── 种子数据：默认套餐 ────────────────────────────────────────────────────────
  const [planRows] = await connection.query('SELECT COUNT(*) AS count FROM plans');
  if (Number(planRows[0].count || 0) === 0) {
    console.log('[init-db] 写入默认套餐数据...');
    await connection.query(`
      INSERT INTO plans (
        code, name, description, billing_mode, quota_period, request_quota, token_quota,
        priority_weight, concurrency_limit, max_output_tokens, status, is_default, sort_order,
        created_at, updated_at
      ) VALUES
      ('free',  '免费版', '适合体验产品基础能力',       'per_request', 'daily',   200,   200000,  10, 1, 1024, 'active', 1, 10, NOW(), NOW()),
      ('basic', '基础版', '按次/按量都可承接的主力套餐', 'hybrid',      'monthly', 3000,  3000000, 30, 2, 2048, 'active', 0, 20, NOW(), NOW()),
      ('pro',   '高级版', '更高优先级与更稳定的排队保障', 'per_token',   'monthly', 10000, 12000000,80, 3, 4096, 'active', 0, 30, NOW(), NOW())
    `);
  }

  // ── 种子数据：默认 LLM 提供商 ─────────────────────────────────────────────────
  const [providerRows] = await connection.query('SELECT COUNT(*) AS count FROM llm_providers');
  if (
    Number(providerRows[0].count || 0) === 0
    && config.openaiBaseUrl
    && config.openaiApiKey
    && config.openaiModel
  ) {
    console.log('[init-db] 写入默认 LLM 提供商...');
    await connection.query(
      `INSERT INTO llm_providers (
        name, provider_type, base_url, api_key, api_key_masked, model,
        standard_model, jailbreak_model, force_jailbreak_model, compression_model,
        available_models_json, max_context_tokens, trim_context_tokens,
        is_active, status, max_concurrency, timeout_ms,
        input_token_price, output_token_price, created_at, updated_at
      ) VALUES (?, 'openai_compatible', ?, ?, ?, ?, ?, ?, ?, ?, ?, 81920, 61440, 1, 'active', 5, 60000, 0, 0, NOW(), NOW())`,
      [
        'Default OpenAI Compatible',
        config.openaiBaseUrl,
        config.openaiApiKey,
        maskApiKey(config.openaiApiKey),
        config.openaiModel,
        config.openaiModel,
        config.openaiModel,
        config.openaiModel,
        config.openaiModel,
        JSON.stringify([config.openaiModel]),
      ],
    );
  }

  const [activeProvidersForPlanBackfill] = await connection.query(`
    SELECT id, model, standard_model, jailbreak_model, force_jailbreak_model
    FROM llm_providers
    WHERE is_active = 1 AND status = 'active'
    ORDER BY id ASC
    LIMIT 1
  `);
  const activeProviderForPlanBackfill = activeProvidersForPlanBackfill[0] || null;
  if (activeProviderForPlanBackfill) {
    const legacyPlanModelsJson = buildLegacyPlanModelsJson(activeProviderForPlanBackfill);
    if (JSON.parse(legacyPlanModelsJson).length) {
      await connection.query(
        "UPDATE plans SET plan_models_json = ?, updated_at = NOW() WHERE plan_models_json IS NULL OR plan_models_json = '' OR plan_models_json = '[]'",
        [legacyPlanModelsJson],
      );
      console.log('[init-db]   ~ 空套餐模型配置已按当前 active provider 回填');
    }
  }

  await connection.end();
  console.log('[init-db] MySQL 数据库初始化完成。');
}

main().catch((error) => {
  console.error('[init-db] 初始化失败:', error.message);
  process.exit(1);
});
