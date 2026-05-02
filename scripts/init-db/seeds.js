'use strict';

const { buildLegacyPlanModelsJson, maskApiKey } = require('./utils');

async function seedDefaults(connection, config, migratePresetModelsFromPlans) {
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

  const presetMigration = await migratePresetModelsFromPlans(connection);
  console.log(`[init-db]   ~ 预设模型迁移完成：新增 ${presetMigration.created} 个，更新 ${presetMigration.updatedPlans} 个套餐`);
}

module.exports = { seedDefaults };
