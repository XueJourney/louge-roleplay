/**
 * @file src/services/plan/hydration.js
 * @description 套餐模型权益 JSON 的解析、默认模型兜底与列表展示字段补齐。
 */

const {
  parsePlanModelsJson,
  buildDefaultPlanModelsFromProvider,
} = require('../model-entitlement-service');
const { getActiveProvider } = require('../llm-provider-service');
const { listPresetModels } = require('../preset-model-service');

function applyPresetModelDetails(planModels = [], presetModels = []) {
  const presetById = new Map((presetModels || []).map((preset) => [Number(preset.id), preset]));
  return planModels.map((item) => {
    const preset = presetById.get(Number(item.presetModelId || item.preset_model_id || 0));
    if (!preset) return item;
    return {
      ...item,
      modelKey: preset.model_key || item.modelKey,
      label: preset.name || item.label,
      description: preset.description || item.description || '',
      presetModelId: Number(preset.id),
      providerId: Number(preset.provider_id || item.providerId || 0),
      modelId: preset.model_id || item.modelId,
      presetStatus: preset.status,
      providerName: preset.provider_name || item.providerName || '',
    };
  });
}

async function hydratePlanModelsForPlan(plan) {
  if (!plan) return null;
  let planModels = parsePlanModelsJson(plan.plan_models_json || '[]');
  if (!planModels.length) {
    planModels = buildDefaultPlanModelsFromProvider(await getActiveProvider());
  } else {
    planModels = applyPresetModelDetails(planModels, await listPresetModels({ includeDisabled: true }));
  }
  return {
    ...plan,
    planModels,
    model_count: planModels.length,
  };
}

async function hydratePlanModelsForPlans(plans = []) {
  const fallbackProvider = plans.some((plan) => !parsePlanModelsJson(plan.plan_models_json || '[]').length)
    ? await getActiveProvider()
    : null;
  const presetModels = await listPresetModels({ includeDisabled: true });
  return plans.map((plan) => {
    let planModels = parsePlanModelsJson(plan.plan_models_json || '[]');
    if (!planModels.length) {
      planModels = buildDefaultPlanModelsFromProvider(fallbackProvider);
    } else {
      planModels = applyPresetModelDetails(planModels, presetModels);
    }
    return {
      ...plan,
      planModels,
      model_count: planModels.length,
    };
  });
}

module.exports = {
  hydratePlanModelsForPlan,
  hydratePlanModelsForPlans,
};
