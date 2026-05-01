/**
 * @file src/services/model-form-service.js
 * @description Parse admin form fields for plan model entitlements.
 */

'use strict';

const { normalizePlanModels } = require('./model-entitlement-service');

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function parsePlanModelsFromBody(body = {}, presetModels = []) {
  const presetModelIds = asArray(body.planModelPresetId);
  const requestMultipliers = asArray(body.planModelRequestMultiplier);
  const tokenMultipliers = asArray(body.planModelTokenMultiplier);
  const defaultPresetIds = new Set(asArray(body.planModelDefaultPresetId).map((item) => String(item || '').trim()).filter(Boolean));
  const presetById = new Map((Array.isArray(presetModels) ? presetModels : []).map((preset) => [String(preset.id), preset]));
  const maxLength = Math.max(presetModelIds.length, requestMultipliers.length, tokenMultipliers.length);
  const items = [];

  for (let index = 0; index < maxLength; index += 1) {
    const presetModelId = String(presetModelIds[index] || '').trim();
    if (!presetModelId) {
      continue;
    }
    const preset = presetById.get(presetModelId);
    if (!preset) {
      items.push({ presetModelId });
      continue;
    }
    items.push({
      presetModelId: Number(preset.id),
      modelKey: preset.model_key,
      label: preset.name,
      description: preset.description || '',
      providerId: preset.provider_id,
      modelId: preset.model_id,
      requestMultiplier: requestMultipliers[index],
      tokenMultiplier: tokenMultipliers[index] || requestMultipliers[index],
      isDefault: defaultPresetIds.has(presetModelId) || (!defaultPresetIds.size && items.length === 0),
      sortOrder: index * 10,
    });
  }

  return normalizePlanModels(items);
}

module.exports = { parsePlanModelsFromBody };
