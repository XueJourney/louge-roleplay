'use strict';

const crypto = require('node:crypto');

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

function maskApiKey(apiKey = '') {
  const raw = String(apiKey || '').trim();
  if (!raw) return '';
  if (raw.length <= 8) return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

function getRandomDigits(length) {
  let value = String(crypto.randomInt(1, 10));
  while (value.length < length) {
    value += String(crypto.randomInt(0, 10));
  }
  return value;
}

function normalizeModelKey(value, fallback = 'model') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

function buildPresetModelLabel(modelId = '') {
  const tail = String(modelId || 'model').split('/').pop() || 'model';
  return tail.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function mergePresetLabels(labels = [], fallback = '') {
  const unique = [...new Set(labels.map((item) => String(item || '').trim()).filter(Boolean))];
  if (!unique.length) return fallback;
  return unique.length === 1 ? unique[0] : unique.slice(0, 3).join(' / ');
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

module.exports = {
  getDatabaseNameFromUrl,
  quoteIdentifier,
  maskApiKey,
  getRandomDigits,
  normalizeModelKey,
  buildPresetModelLabel,
  mergePresetLabels,
  buildLegacyPlanModelsJson,
};
