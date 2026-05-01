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

function parsePlanModelsFromBody(body = {}) {
  const modelKeys = asArray(body.planModelKey);
  const labels = asArray(body.planModelLabel);
  const providerIds = asArray(body.planModelProviderId);
  const modelIds = asArray(body.planModelId);
  const requestMultipliers = asArray(body.planModelRequestMultiplier);
  const tokenMultipliers = asArray(body.planModelTokenMultiplier);
  const defaultKeys = new Set(asArray(body.planModelDefaultKey).map((item) => String(item || '').trim()).filter(Boolean));
  const maxLength = Math.max(modelKeys.length, labels.length, providerIds.length, modelIds.length, requestMultipliers.length, tokenMultipliers.length);
  const items = [];

  for (let index = 0; index < maxLength; index += 1) {
    const modelId = String(modelIds[index] || '').trim();
    if (!modelId) {
      continue;
    }
    const modelKey = String(modelKeys[index] || '').trim();
    items.push({
      modelKey,
      label: String(labels[index] || '').trim(),
      providerId: providerIds[index],
      modelId,
      requestMultiplier: requestMultipliers[index],
      tokenMultiplier: tokenMultipliers[index] || requestMultipliers[index],
      isDefault: defaultKeys.has(modelKey) || (!defaultKeys.size && items.length === 0),
      sortOrder: index * 10,
    });
  }

  return normalizePlanModels(items);
}

module.exports = { parsePlanModelsFromBody };
