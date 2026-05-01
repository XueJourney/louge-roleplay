/**
 * @file src/services/plan/hydration.js
 * @description 套餐模型权益 JSON 的解析、默认模型兜底与列表展示字段补齐。
 */

const {
  parsePlanModelsJson,
  buildDefaultPlanModelsFromProvider,
} = require('../model-entitlement-service');
const { getActiveProvider } = require('../llm-provider-service');

async function hydratePlanModelsForPlan(plan) {
  if (!plan) return null;
  let planModels = parsePlanModelsJson(plan.plan_models_json || '[]');
  if (!planModels.length) {
    planModels = buildDefaultPlanModelsFromProvider(await getActiveProvider());
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
  return plans.map((plan) => {
    let planModels = parsePlanModelsJson(plan.plan_models_json || '[]');
    if (!planModels.length) {
      planModels = buildDefaultPlanModelsFromProvider(fallbackProvider);
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
