'use strict';

async function ensureUsersAndPlans(connection, helpers, backfillUserPublicIds) {
  const { ensureColumn, ensureIndex, ensureUniqueIndex } = helpers;
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
      show_nsfw     TINYINT(1) NOT NULL DEFAULT 0,
      reply_length_preference ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
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
  await ensureColumn('users', 'show_nsfw',      'show_nsfw TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('users', 'reply_length_preference', "reply_length_preference ENUM('low','medium','high') NOT NULL DEFAULT 'medium'");
  await ensureUniqueIndex('users', 'uniq_users_email', 'email');
  await ensureUniqueIndex('users', 'uniq_users_phone', 'phone');
  await backfillUserPublicIds(connection);
  await ensureUniqueIndex('users', 'uniq_users_public_id', 'public_id');

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

  console.log('[init-db] 初始化 preset_models 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS preset_models (
      id            BIGINT PRIMARY KEY AUTO_INCREMENT,
      provider_id   BIGINT NOT NULL,
      model_key     VARCHAR(80) NOT NULL,
      model_id      VARCHAR(200) NOT NULL,
      name          VARCHAR(120) NOT NULL,
      description   VARCHAR(1000) NULL,
      status        ENUM('active','disabled') NOT NULL DEFAULT 'active',
      sort_order    INT NOT NULL DEFAULT 0,
      metadata_json LONGTEXT NULL,
      created_at    DATETIME NOT NULL,
      updated_at    DATETIME NOT NULL,
      UNIQUE INDEX uniq_preset_models_provider_model (provider_id, model_id),
      INDEX idx_preset_models_status (status, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn('preset_models', 'model_key',     "model_key VARCHAR(80) NOT NULL DEFAULT ''");
  await ensureColumn('preset_models', 'description',   'description VARCHAR(1000) NULL');
  await ensureColumn('preset_models', 'status',        "status ENUM('active','disabled') NOT NULL DEFAULT 'active'");
  await ensureColumn('preset_models', 'sort_order',    'sort_order INT NOT NULL DEFAULT 0');
  await ensureColumn('preset_models', 'metadata_json', 'metadata_json LONGTEXT NULL');
  await ensureUniqueIndex('preset_models', 'uniq_preset_models_provider_model', 'provider_id, model_id');
  await ensureIndex('preset_models', 'idx_preset_models_status', '(status, sort_order)');

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
}

async function ensureMessagingAndProviderSchema(connection, helpers) {
  const { ensureColumn, ensureIndex } = helpers;
  console.log('[init-db] 初始化 site_messages / recipients 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS site_messages (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(120) NOT NULL,
      body TEXT NOT NULL,
      sender_admin_user_id BIGINT NULL,
      target_mode ENUM('all','filtered','users') NOT NULL DEFAULT 'all',
      filter_role ENUM('any','user','admin') NOT NULL DEFAULT 'any',
      filter_status ENUM('any','active','blocked') NOT NULL DEFAULT 'any',
      filter_plan_code VARCHAR(50) NULL,
      is_important TINYINT(1) NOT NULL DEFAULT 0,
      recipient_count INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_site_messages_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS site_message_recipients (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      message_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL,
      UNIQUE INDEX uniq_site_message_recipient (message_id, user_id),
      INDEX idx_site_message_recipients_user_read (user_id, is_read, created_at),
      CONSTRAINT fk_site_message_recipients_message FOREIGN KEY (message_id) REFERENCES site_messages(id) ON DELETE CASCADE,
      CONSTRAINT fk_site_message_recipients_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

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

  console.log('[init-db] 初始化 notifications 表...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(120) NOT NULL,
      body TEXT NOT NULL,
      notification_type ENUM('general','new_user','support','error','maintenance') NOT NULL DEFAULT 'general',
      audience ENUM('all','guest','user','admin') NOT NULL DEFAULT 'all',
      display_scopes VARCHAR(160) NOT NULL DEFAULT 'global',
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
  await ensureColumn('notifications', 'display_scopes', "display_scopes VARCHAR(160) NOT NULL DEFAULT 'global' AFTER audience");
  await connection.query("UPDATE notifications SET display_scopes = 'global' WHERE display_scopes IS NULL OR display_scopes = ''");
  await ensureIndex('notifications', 'idx_notifications_display_scopes', '(display_scopes)');
}

module.exports = {
  ensureUsersAndPlans,
  ensureMessagingAndProviderSchema,
};
