/**
 * @file src/lib/sqlite-schema/seed.js
 * @description 默认套餐、默认 LLM provider 与旧套餐模型权益回填。
 */

'use strict';

const config = require('../../config');

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

function seedSqliteDefaults(db) {
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

module.exports = { seedSqliteDefaults };
