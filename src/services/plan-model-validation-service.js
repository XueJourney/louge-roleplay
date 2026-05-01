/**
 * @file src/services/plan-model-validation-service.js
 * @description Server-side validation for plan model entitlements against configured providers.
 */

'use strict';

const { listProviders } = require('./llm-provider-service');

function buildProviderModelLookup(providers = []) {
  const lookup = new Map();
  providers.forEach((provider) => {
    const providerId = Number(provider.id || 0);
    const modelIds = new Set((provider.availableModels || []).map((model) => String(model.id || '').trim()).filter(Boolean));
    lookup.set(providerId, { provider, modelIds });
  });
  return lookup;
}

async function validatePlanModelsAgainstProviders(planModels = []) {
  const providers = await listProviders();
  const lookup = buildProviderModelLookup(providers);

  if (!providers.length) {
    throw new Error('PLAN_MODEL_PROVIDER_REQUIRED');
  }

  for (const item of planModels) {
    const providerId = Number(item.providerId || 0);
    const modelId = String(item.modelId || '').trim();
    const entry = lookup.get(providerId);
    if (!entry) {
      throw new Error('PLAN_MODEL_PROVIDER_INVALID');
    }
    if (!entry.modelIds.has(modelId)) {
      throw new Error('PLAN_MODEL_NOT_FOUND_IN_PROVIDER');
    }
  }

  return true;
}

module.exports = {
  validatePlanModelsAgainstProviders,
};
