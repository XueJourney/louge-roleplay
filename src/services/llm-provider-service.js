/**
 * @file src/services/llm-provider-service.js
 * @description LLM 提供商配置查询、创建、更新与模型自动发现。
 */

const { query } = require('../lib/db');
const { assertSafeExternalHttpUrl } = require('../lib/url-safety');

const MODEL_MODE_KEYS = [
  'standardModel',
  'jailbreakModel',
  'forceJailbreakModel',
  'compressionModel',
];

function maskApiKey(apiKey = '') {
  const raw = String(apiKey || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.length <= 8) {
    return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
  }
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

function normalizeBaseUrl(baseUrl = '') {
  return String(baseUrl || '').trim().replace(/\/$/, '');
}

function pickDefaultModel(models = []) {
  if (!Array.isArray(models) || models.length === 0) {
    return '';
  }

  const preferredPatterns = [
    'claude-sonnet',
    'gpt-5',
    'claude',
    'gemini',
    'grok',
    'glm',
    'qwen',
  ];

  for (const pattern of preferredPatterns) {
    const matched = models.find((model) => String(model || '').toLowerCase().includes(pattern));
    if (matched) {
      return matched;
    }
  }

  return models[0];
}

function buildModelOptions(models = []) {
  return models
    .map((modelId) => {
      const id = String(modelId || '').trim();
      if (!id) {
        return null;
      }
      const displayName = id
        .split('/')
        .pop()
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
      return {
        id,
        label: displayName || id,
        searchText: `${displayName} ${id}`.toLowerCase(),
      };
    })
    .filter(Boolean);
}

function resolveProviderModels(provider = {}) {
  const raw = provider.available_models_json;
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => String(item || '').trim()).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function ensurePositiveInteger(value, fallback) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }
  return Math.floor(normalized);
}

function ensureNonNegativeNumber(value, fallback = 0) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return fallback;
  }
  return normalized;
}

function validateContextWindow(maxContextTokens, trimContextTokens) {
  if (trimContextTokens >= maxContextTokens) {
    throw new Error('CONTEXT_WINDOW_INVALID: trim_context_tokens must be smaller than max_context_tokens');
  }
}

function validateProviderModels(models = [], payload = {}) {
  const modelSet = new Set((models || []).map((item) => String(item || '').trim()).filter(Boolean));
  for (const field of MODEL_MODE_KEYS) {
    const value = String(payload[field] || '').trim();
    if (!value) {
      continue;
    }
    if (!modelSet.has(value)) {
      throw new Error(`MODEL_NOT_FOUND_IN_PROVIDER: ${field}`);
    }
  }
}


async function fetchProviderModels(baseUrl, apiKey) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  let response;
  try {
    response = await fetch(`${normalizedBaseUrl}/v1/models`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${String(apiKey || '').trim()}`,
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('MODEL_DISCOVERY_FAILED: request timed out after 15s');
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MODEL_DISCOVERY_FAILED: ${response.status} ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const models = Array.isArray(data?.data)
    ? data.data.map((item) => String(item?.id || '').trim()).filter(Boolean)
    : [];

  if (models.length === 0) {
    throw new Error('MODEL_DISCOVERY_FAILED: provider returned empty model list');
  }

  return {
    models,
    modelOptions: buildModelOptions(models),
    defaultModel: pickDefaultModel(models),
  };
}

async function getActiveProvider() {
  const rows = await query(
    `SELECT id, name, provider_type, base_url, api_key, model, standard_model, jailbreak_model,
            force_jailbreak_model, compression_model, available_models_json,
            max_context_tokens, trim_context_tokens,
            is_active, status, max_concurrency, timeout_ms,
            input_token_price, output_token_price
     FROM llm_providers
     WHERE is_active = 1 AND status = 'active'
     ORDER BY id ASC
     LIMIT 1`,
  );
  return rows[0] || null;
}

async function listProviders() {
  const rows = await query(
    `SELECT id, name, provider_type, base_url, api_key_masked, model,
            standard_model, jailbreak_model, force_jailbreak_model, compression_model,
            available_models_json, max_context_tokens, trim_context_tokens,
            is_active, status, max_concurrency, timeout_ms, input_token_price, output_token_price, created_at, updated_at
     FROM llm_providers
     ORDER BY is_active DESC, id ASC`,
  );

  return rows.map((provider) => ({
    ...provider,
    availableModels: buildModelOptions(resolveProviderModels(provider)),
  }));
}

async function createProvider(payload) {
  const apiKey = String(payload.apiKey || '').trim();
  const baseUrl = normalizeBaseUrl(payload.baseUrl || '');
  await assertSafeExternalHttpUrl(baseUrl, { label: 'Provider Base URL' });
  const discovered = await fetchProviderModels(baseUrl, apiKey);
  validateProviderModels(discovered.models, payload);
  const fallbackModel = String(payload.standardModel || payload.model || '').trim() || discovered.defaultModel;
  const standardModel = String(payload.standardModel || '').trim() || fallbackModel;
  const jailbreakModel = String(payload.jailbreakModel || '').trim() || standardModel;
  const forceJailbreakModel = String(payload.forceJailbreakModel || '').trim() || jailbreakModel;
  const compressionModel = String(payload.compressionModel || '').trim() || standardModel;
  const maxContextTokens = ensurePositiveInteger(payload.maxContextTokens, 81920);
  const trimContextTokens = ensurePositiveInteger(payload.trimContextTokens, 61440);
  validateContextWindow(maxContextTokens, trimContextTokens);
  const maxConcurrency = ensurePositiveInteger(payload.maxConcurrency, 5);
  const timeoutMs = ensurePositiveInteger(payload.timeoutMs, 60000);
  const inputTokenPrice = ensureNonNegativeNumber(payload.inputTokenPrice, 0);
  const outputTokenPrice = ensureNonNegativeNumber(payload.outputTokenPrice, 0);

  const result = await query(
    `INSERT INTO llm_providers (
      name, provider_type, base_url, api_key, api_key_masked, model,
      standard_model, jailbreak_model, force_jailbreak_model, compression_model, available_models_json,
      max_context_tokens, trim_context_tokens,
      is_active, status, max_concurrency, timeout_ms, input_token_price, output_token_price, created_at, updated_at
    ) VALUES (?, 'openai_compatible', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      String(payload.name || '').trim(),
      baseUrl,
      apiKey,
      maskApiKey(apiKey),
      standardModel,
      standardModel,
      jailbreakModel,
      forceJailbreakModel,
      compressionModel,
      JSON.stringify(discovered.models),
      maxContextTokens,
      trimContextTokens,
      payload.isActive ? 1 : 0,
      String(payload.status || 'active').trim(),
      maxConcurrency,
      timeoutMs,
      inputTokenPrice,
      outputTokenPrice,
    ],
  );

  if (payload.isActive) {
    await query('UPDATE llm_providers SET is_active = 0, updated_at = NOW() WHERE id <> ?', [result.insertId]);
    await query('UPDATE llm_providers SET is_active = 1, updated_at = NOW() WHERE id = ?', [result.insertId]);
  }

  return result.insertId;
}

async function updateProvider(providerId, payload) {
  const provider = await query('SELECT * FROM llm_providers WHERE id = ? LIMIT 1', [providerId]);
  const current = provider[0];
  if (!current) {
    throw new Error('Provider not found');
  }

  const apiKey = String(payload.apiKey || '').trim() || current.api_key;
  const baseUrl = normalizeBaseUrl(payload.baseUrl || current.base_url);
  await assertSafeExternalHttpUrl(baseUrl, { label: 'Provider Base URL' });
  const shouldRefreshModels = baseUrl !== current.base_url || apiKey !== current.api_key || String(payload.refreshModels || '') === '1';
  const discovered = shouldRefreshModels
    ? await fetchProviderModels(baseUrl, apiKey)
    : { models: resolveProviderModels(current), defaultModel: current.standard_model || current.model || '' };
  validateProviderModels(discovered.models, payload);

  const standardModel = String(payload.standardModel || '').trim() || current.standard_model || current.model || discovered.defaultModel;
  const jailbreakModel = String(payload.jailbreakModel || '').trim() || current.jailbreak_model || standardModel;
  const forceJailbreakModel = String(payload.forceJailbreakModel || '').trim() || current.force_jailbreak_model || jailbreakModel;
  const compressionModel = String(payload.compressionModel || '').trim() || current.compression_model || standardModel;
  const maxContextTokens = ensurePositiveInteger(payload.maxContextTokens, current.max_context_tokens || 81920);
  const trimContextTokens = ensurePositiveInteger(payload.trimContextTokens, current.trim_context_tokens || 61440);
  validateContextWindow(maxContextTokens, trimContextTokens);
  const maxConcurrency = ensurePositiveInteger(payload.maxConcurrency, current.max_concurrency || 5);
  const timeoutMs = ensurePositiveInteger(payload.timeoutMs, current.timeout_ms || 60000);
  const inputTokenPrice = ensureNonNegativeNumber(payload.inputTokenPrice, current.input_token_price || 0);
  const outputTokenPrice = ensureNonNegativeNumber(payload.outputTokenPrice, current.output_token_price || 0);

  await query(
    `UPDATE llm_providers
     SET name = ?,
         base_url = ?,
         api_key = ?,
         api_key_masked = ?,
         model = ?,
         standard_model = ?,
         jailbreak_model = ?,
         force_jailbreak_model = ?,
         compression_model = ?,
         available_models_json = ?,
         max_context_tokens = ?,
         trim_context_tokens = ?,
         is_active = ?,
         status = ?,
         max_concurrency = ?,
         timeout_ms = ?,
         input_token_price = ?,
         output_token_price = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      String(payload.name || current.name).trim(),
      baseUrl,
      apiKey,
      maskApiKey(apiKey),
      standardModel,
      standardModel,
      jailbreakModel,
      forceJailbreakModel,
      compressionModel,
      JSON.stringify(discovered.models || resolveProviderModels(current)),
      maxContextTokens,
      trimContextTokens,
      payload.isActive ? 1 : 0,
      String(payload.status || current.status).trim(),
      maxConcurrency,
      timeoutMs,
      inputTokenPrice,
      outputTokenPrice,
      providerId,
    ],
  );

  if (payload.isActive) {
    await query('UPDATE llm_providers SET is_active = 0, updated_at = NOW() WHERE id <> ?', [providerId]);
    await query('UPDATE llm_providers SET is_active = 1, updated_at = NOW() WHERE id = ?', [providerId]);
  }
}

module.exports = {
  maskApiKey,
  normalizeBaseUrl,
  fetchProviderModels,
  buildModelOptions,
  resolveProviderModels,
  getActiveProvider,
  listProviders,
  createProvider,
  updateProvider,
};
