/**
 * @file src/services/model-entitlement-service.js
 * @description Plan-specific model entitlement normalization, persistence helpers, and quota multiplier math.
 */

'use strict';

const DEFAULT_MODEL_KEY = 'standard';
const LEGACY_MODEL_LABELS = {
  standard: '标准模型',
  jailbreak: '破限模型',
  force_jailbreak: '强破限模型',
};

function normalizeModelKey(value, fallback = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

function normalizeMultiplier(value, fallback = 1) {
  const normalized = Number(value ?? fallback);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return Number(fallback) > 0 ? Number(fallback) : 1;
  }
  return Math.max(0.01, Math.round(normalized * 100) / 100);
}

function normalizeProviderId(value, fallback = null) {
  const normalized = Number(value ?? fallback);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    return fallback && Number.isSafeInteger(Number(fallback)) ? Number(fallback) : null;
  }
  return normalized;
}

function buildPlanModelLabel(modelKey, modelId = '') {
  const key = normalizeModelKey(modelKey, DEFAULT_MODEL_KEY);
  if (LEGACY_MODEL_LABELS[key]) {
    return LEGACY_MODEL_LABELS[key];
  }
  const tail = String(modelId || key).split('/').pop() || key;
  return tail
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizePlanModelItem(item = {}, index = 0, options = {}) {
  const fallbackProviderId = normalizeProviderId(options.fallbackProviderId || null);
  const presetModelId = normalizeProviderId(item.presetModelId ?? item.preset_model_id, null);
  const modelKey = normalizeModelKey(item.modelKey ?? item.model_key ?? item.mode ?? item.key, index === 0 ? DEFAULT_MODEL_KEY : `model-${index + 1}`);
  const modelId = String(item.modelId ?? item.model_id ?? item.hiddenModelId ?? item.model ?? '').trim();
  if (!modelId) {
    return null;
  }
  const requestMultiplier = normalizeMultiplier(item.requestMultiplier ?? item.request_multiplier ?? item.multiplier, 1);
  const tokenMultiplier = normalizeMultiplier(item.tokenMultiplier ?? item.token_multiplier ?? item.multiplier, requestMultiplier);
  return {
    modelKey,
    label: String(item.label || item.name || '').trim() || buildPlanModelLabel(modelKey, modelId),
    description: String(item.description || item.modelDescription || item.model_description || '').trim(),
    presetModelId,
    providerId: normalizeProviderId(item.providerId ?? item.provider_id, fallbackProviderId),
    modelId,
    requestMultiplier,
    tokenMultiplier,
    isDefault: Boolean(Number(item.isDefault ?? item.is_default ?? 0)) || Boolean(item.isDefault === true),
    sortOrder: Number.isSafeInteger(Number(item.sortOrder ?? item.sort_order)) ? Number(item.sortOrder ?? item.sort_order) : index * 10,
  };
}

function normalizePlanModels(items = [], options = {}) {
  const normalized = [];
  const seenKeys = new Set();
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const normalizedItem = normalizePlanModelItem(item, index, options);
    if (!normalizedItem || seenKeys.has(normalizedItem.modelKey)) {
      return;
    }
    seenKeys.add(normalizedItem.modelKey);
    normalized.push(normalizedItem);
  });
  normalized.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.modelKey.localeCompare(b.modelKey));
  if (normalized.length) {
    const defaultIndex = normalized.findIndex((item) => item.isDefault);
    normalized.forEach((item, index) => {
      item.isDefault = defaultIndex >= 0 ? index === defaultIndex : index === 0;
    });
  }
  return normalized;
}

function parsePlanModelsJson(value, options = {}) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(String(value));
    return normalizePlanModels(Array.isArray(parsed) ? parsed : [], options);
  } catch (_) {
    return [];
  }
}

function serializePlanModels(items = []) {
  return JSON.stringify(normalizePlanModels(items).map((item) => ({
    modelKey: item.modelKey,
    label: item.label,
    description: item.description || '',
    presetModelId: item.presetModelId || null,
    providerId: item.providerId,
    modelId: item.modelId,
    requestMultiplier: item.requestMultiplier,
    tokenMultiplier: item.tokenMultiplier,
    isDefault: item.isDefault,
    sortOrder: item.sortOrder,
  })));
}

function buildDefaultPlanModelsFromProvider(provider = null) {
  if (!provider) {
    return [];
  }
  const entries = [
    ['standard', '标准模型', provider.standard_model || provider.model],
    ['jailbreak', '破限模型', provider.jailbreak_model || provider.standard_model || provider.model],
    ['force_jailbreak', '强破限模型', provider.force_jailbreak_model || provider.jailbreak_model || provider.standard_model || provider.model],
  ];
  return normalizePlanModels(entries.map(([modelKey, label, modelId], index) => ({
    modelKey,
    label,
    providerId: provider.id,
    modelId,
    requestMultiplier: 1,
    tokenMultiplier: 1,
    isDefault: index === 0,
    sortOrder: index * 10,
  })));
}

function findPlanModel(planModels = [], selectedModelKey = '') {
  const normalized = normalizePlanModels(planModels);
  if (!normalized.length) {
    return null;
  }
  const key = normalizeModelKey(selectedModelKey, '');
  return normalized.find((item) => item.modelKey === key)
    || normalized.find((item) => item.isDefault)
    || normalized[0]
    || null;
}

function getBillableRequestUnits(modelConfig = null) {
  return Math.max(1, Math.ceil(normalizeMultiplier(modelConfig?.requestMultiplier ?? modelConfig?.request_multiplier, 1)));
}

function getBillableTokenUnits(tokens = 0, modelConfig = null) {
  const baseTokens = Math.max(0, Math.ceil(Number(tokens || 0)));
  return Math.max(0, Math.ceil(baseTokens * normalizeMultiplier(modelConfig?.tokenMultiplier ?? modelConfig?.token_multiplier, 1)));
}

module.exports = {
  DEFAULT_MODEL_KEY,
  normalizeModelKey,
  normalizeMultiplier,
  normalizePlanModels,
  parsePlanModelsJson,
  serializePlanModels,
  buildDefaultPlanModelsFromProvider,
  findPlanModel,
  getBillableRequestUnits,
  getBillableTokenUnits,
};
