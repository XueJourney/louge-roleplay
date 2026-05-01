/**
 * @file src/services/plan-service.js
 * @description 套餐与用户订阅服务兼容门面；具体 CRUD、订阅和配额逻辑位于 `src/services/plan/`。
 */

'use strict';

const {
  listPlans,
  findPlanById,
  createPlan,
  updatePlan,
  deletePlan,
} = require('./plan/crud');
const {
  assignDefaultPlanToUser,
  getActiveSubscriptionForUser,
  getCurrentUsageForUser,
  getUserQuotaSnapshot,
  assertUserQuotaAvailable,
  getSubscriptionModelConfig,
  buildPlanModelOptions,
  updateUserPlan,
} = require('./plan/subscriptions');

module.exports = {
  assignDefaultPlanToUser,
  listPlans,
  findPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  getActiveSubscriptionForUser,
  getCurrentUsageForUser,
  getUserQuotaSnapshot,
  assertUserQuotaAvailable,
  getSubscriptionModelConfig,
  buildPlanModelOptions,
  updateUserPlan,
};
