/**
 * @file src/services/plan/subscriptions.js
 * @description 用户套餐订阅、用量统计、配额断言和套餐模型选项。
 */

const { query, withTransaction, getDbType } = require('../../lib/db');
const {
  parsePlanModelsJson,
  findPlanModel,
  getBillableRequestUnits,
  getBillableTokenUnits,
} = require('../model-entitlement-service');
const { hydratePlanModelsForPlan } = require('./hydration');
const { buildUsageSinceClause } = require('./usage-window');

async function assignDefaultPlanToUser(conn, userId) {
  const [plans] = await conn.execute(
    `SELECT id FROM plans
     WHERE is_default = 1 AND status = ?
     ORDER BY sort_order ASC, id ASC
     LIMIT 1`,
    ['active'],
  );

  const defaultPlan = plans[0];
  if (!defaultPlan) {
    throw new Error('Default plan is not configured');
  }

  await conn.execute(
    `INSERT INTO user_subscriptions (
       user_id, plan_id, status, started_at, created_at, updated_at
     ) VALUES (?, ?, 'active', NOW(), NOW(), NOW())`,
    [userId, defaultPlan.id],
  );
}

async function getActiveSubscriptionForUser(userId) {
  const rows = await query(
    `SELECT
       us.id, us.user_id, us.plan_id, us.status, us.started_at, us.ended_at,
       p.code AS plan_code, p.name AS plan_name, p.description AS plan_description,
       p.billing_mode, p.quota_period, p.request_quota, p.token_quota,
       p.priority_weight, p.concurrency_limit, p.max_output_tokens,
       p.plan_models_json,
       p.status AS plan_status
     FROM user_subscriptions us
     INNER JOIN plans p ON p.id = us.plan_id
     WHERE us.user_id = ? AND us.status = 'active' AND p.status = 'active'
     ORDER BY us.id DESC
     LIMIT 1`,
    [userId],
  );
  return hydratePlanModelsForPlan(rows[0] || null);
}

async function getCurrentUsageForUser(userId, subscription = null) {
  const activeSubscription = subscription || await getActiveSubscriptionForUser(userId);
  if (!activeSubscription) {
    return { usedRequests: 0, usedTokens: 0 };
  }

  const sinceClause = buildUsageSinceClause(activeSubscription, getDbType());

  const rows = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'success' THEN billable_request_units ELSE 0 END), 0) AS used_requests,
       COALESCE(SUM(CASE WHEN status = 'success' THEN billable_tokens ELSE 0 END), 0)        AS used_tokens
     FROM llm_usage_logs
     WHERE user_id = ?
       AND plan_id = ?
       ${sinceClause}`,
    [userId, activeSubscription.plan_id],
  );

  return {
    usedRequests: Number(rows[0]?.used_requests || 0),
    usedTokens: Number(rows[0]?.used_tokens || 0),
  };
}

async function getUserQuotaSnapshot(userId) {
  const subscription = await getActiveSubscriptionForUser(userId);
  if (!subscription) return null;

  const usage = await getCurrentUsageForUser(userId, subscription);

  return {
    subscription,
    usage,
    remainingRequests: Math.max(0, Number(subscription.request_quota || 0) - usage.usedRequests),
    remainingTokens: Math.max(0, Number(subscription.token_quota || 0) - usage.usedTokens),
  };
}

async function assertUserQuotaAvailable(userId, estimatedTokens = 0, modelConfig = null) {
  const snapshot = await getUserQuotaSnapshot(userId);
  if (!snapshot) {
    throw new Error('User plan is not configured');
  }

  const { subscription, remainingRequests, remainingTokens } = snapshot;
  const billingMode = String(subscription.billing_mode || 'per_request');
  const billableRequestUnits = getBillableRequestUnits(modelConfig);
  const billableEstimatedTokens = getBillableTokenUnits(estimatedTokens, modelConfig);

  if ((billingMode === 'per_request' || billingMode === 'hybrid') && remainingRequests < billableRequestUnits) {
    throw new Error('REQUEST_QUOTA_EXCEEDED');
  }

  if ((billingMode === 'per_token' || billingMode === 'hybrid') && billableEstimatedTokens > remainingTokens) {
    throw new Error('TOKEN_QUOTA_EXCEEDED');
  }

  return {
    ...snapshot,
    selectedModel: modelConfig || null,
    billableRequestUnits,
    billableEstimatedTokens,
  };
}

function getSubscriptionModelConfig(subscription, selectedModelKey = '') {
  const modelConfig = findPlanModel(subscription?.planModels || parsePlanModelsJson(subscription?.plan_models_json || '[]'), selectedModelKey);
  if (!modelConfig) {
    throw new Error('MODEL_NOT_AVAILABLE_FOR_PLAN');
  }
  return modelConfig;
}

function buildPlanModelOptions(subscription) {
  return (subscription?.planModels || parsePlanModelsJson(subscription?.plan_models_json || '[]')).map((item) => ({
    mode: item.modelKey,
    label: item.label,
    description: item.description || '',
    enabled: true,
    requestMultiplier: item.requestMultiplier,
    tokenMultiplier: item.tokenMultiplier,
    providerId: item.providerId,
    displayName: item.label,
    hiddenModelId: item.modelId,
    isDefault: item.isDefault,
  }));
}

async function updateUserPlan(userId, planId) {
  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE user_subscriptions
       SET status = 'expired', ended_at = NOW(), updated_at = NOW()
       WHERE user_id = ? AND status = 'active'`,
      [userId],
    );

    await conn.execute(
      `INSERT INTO user_subscriptions (
         user_id, plan_id, status, started_at, created_at, updated_at
       ) VALUES (?, ?, 'active', NOW(), NOW(), NOW())`,
      [userId, planId],
    );
  });
}

module.exports = {
  assignDefaultPlanToUser,
  getActiveSubscriptionForUser,
  getCurrentUsageForUser,
  getUserQuotaSnapshot,
  assertUserQuotaAvailable,
  getSubscriptionModelConfig,
  buildPlanModelOptions,
  updateUserPlan,
};
