/**
 * @file src/services/plan-service.js
 * @description
 * 套餐与用户订阅服务：套餐 CRUD、订阅状态查询、配额校验与用量统计。
 *
 * 核心逻辑：
 *   - 每个用户同一时间最多有一条 status='active' 的订阅记录
 *   - 配额以 billing_mode（per_request / per_token / hybrid）+ quota_period（daily / monthly / lifetime）决定
 *   - assertUserQuotaAvailable() 在每次 LLM 调用前调用，超额时抛出特定错误码
 *
 * 数据库兼容性：
 *   - buildUsageSinceClause() 根据当前 dbType 生成不同的日期范围 SQL 片段，
 *     兼容 MySQL（DATE_SUB）与 SQLite（datetime 函数）
 *   - 事务操作通过 withTransaction() 实现，不直接使用 pool.getConnection()
 *
 * 公共函数：
 *   assignDefaultPlanToUser(conn, userId)        事务内分配默认套餐（由 user-service 调用）
 *   listPlans()                                  列出全部套餐
 *   findPlanById(planId)                         按 ID 查询套餐
 *   createPlan(payload)                          新建套餐
 *   updatePlan(planId, payload)                  更新套餐
 *   deletePlan(planId)                           删除套餐（有订阅时拒绝）
 *   getActiveSubscriptionForUser(userId)         获取当前活跃订阅（含套餐信息）
 *   getCurrentUsageForUser(userId, subscription) 统计当前周期用量
 *   getUserQuotaSnapshot(userId)                 获取订阅 + 用量 + 剩余配额快照
 *   assertUserQuotaAvailable(userId, tokens, model) 配额不足时抛出 REQUEST/TOKEN_QUOTA_EXCEEDED
 *   updateUserPlan(userId, planId)               变更用户套餐（原子事务）
 */

'use strict';

const { query, withTransaction, getDbType } = require('../lib/db');
const {
  parsePlanModelsJson,
  serializePlanModels,
  buildDefaultPlanModelsFromProvider,
  findPlanModel,
  getBillableRequestUnits,
  getBillableTokenUnits,
} = require('./model-entitlement-service');
const { getActiveProvider } = require('./llm-provider-service');

// ─── 内部辅助函数 ─────────────────────────────────────────────────────────────

/**
 * 验证并返回非负整数，不合法时抛出错误。
 * @param {any} value
 * @param {string} fieldLabel
 * @param {number} [fallback=0]
 * @returns {number}
 */
function ensureNonNegativeInteger(value, fieldLabel, fallback = 0) {
  const normalized = Number(value ?? fallback);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${fieldLabel} must be a non-negative integer`);
  }
  return normalized;
}

/**
 * 验证并返回正整数，不合法时抛出错误。
 * @param {any} value
 * @param {string} fieldLabel
 * @param {number} [fallback=1]
 * @returns {number}
 */
function ensurePositiveInteger(value, fieldLabel, fallback = 1) {
  const normalized = Number(value ?? fallback);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error(`${fieldLabel} must be a positive integer`);
  }
  return normalized;
}

/**
 * 标准化并验证套餐载荷，处理 billing_mode 与 quota 的联动约束。
 * @param {object} payload
 * @param {object|null} [current]  已有套餐记录（用于 UPDATE 时保留未传字段的旧值）
 * @returns {object}
 */
function normalizePlanPayload(payload = {}, current = null) {
  const billingMode = String(payload.billingMode || current?.billing_mode || 'per_request').trim();
  const quotaPeriod  = String(payload.quotaPeriod  || current?.quota_period  || 'monthly').trim();
  const status       = String(payload.status       || current?.status        || 'active').trim();

  const requestQuotaInput = payload.requestQuota ?? current?.request_quota ?? 0;
  const tokenQuotaInput   = payload.tokenQuota   ?? current?.token_quota   ?? 0;

  return {
    billingMode,
    quotaPeriod,
    status,
    // per_token 模式不计请求次数；per_request 模式不计 token
    requestQuota:     billingMode === 'per_token'   ? 0 : ensureNonNegativeInteger(requestQuotaInput, 'requestQuota'),
    tokenQuota:       billingMode === 'per_request' ? 0 : ensureNonNegativeInteger(tokenQuotaInput,   'tokenQuota'),
    priorityWeight:   ensureNonNegativeInteger(payload.priorityWeight  ?? current?.priority_weight  ?? 0,    'priorityWeight'),
    concurrencyLimit: ensurePositiveInteger(   payload.concurrencyLimit ?? current?.concurrency_limit ?? 1,  'concurrencyLimit'),
    maxOutputTokens:  ensurePositiveInteger(   payload.maxOutputTokens  ?? current?.max_output_tokens ?? 1024, 'maxOutputTokens'),
    sortOrder:        ensureNonNegativeInteger(payload.sortOrder         ?? current?.sort_order         ?? 0,  'sortOrder'),
    isDefault:        Boolean(payload.isDefault),
    planModels:       Array.isArray(payload.planModels) ? payload.planModels : parsePlanModelsJson(current?.plan_models_json || '[]'),
  };
}

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

/**
 * 根据当前数据库类型生成用量统计的日期范围 SQL 片段。
 *
 * MySQL 使用 DATE_SUB(NOW(), INTERVAL n DAY/MONTH)；
 * SQLite 使用 datetime('now', '-n day/month')。
 *
 * @param {object} subscription  活跃订阅对象，含 quota_period 字段
 * @returns {string} SQL WHERE 子句片段，如 "AND created_at >= ..." 或 ""（lifetime）
 */
function buildUsageSinceClause(subscription) {
  const period = String(subscription.quota_period || 'lifetime');
  const isSQLite = getDbType() === 'sqlite';

  if (period === 'daily') {
    return isSQLite
      ? "AND created_at >= datetime('now', '-1 day')"
      : 'AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)';
  }

  if (period === 'monthly') {
    return isSQLite
      ? "AND created_at >= datetime('now', '-1 month')"
      : 'AND created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
  }

  // lifetime：统计全部历史记录，不限时间
  return '';
}

// ─── 订阅内部操作 ─────────────────────────────────────────────────────────────

/**
 * 在事务上下文中为新用户分配默认套餐（is_default=1，status='active'）。
 * 此函数由 user-service.createUser() 在同一事务中调用，不单独开事务。
 *
 * @param {{ execute(sql: string, params?: any[]): Promise<[any, any[]]> }} conn  事务连接对象
 * @param {number} userId  新用户 ID
 * @returns {Promise<void>}
 * @throws {Error} 'Default plan is not configured' — 数据库中没有 is_default=1 的套餐
 */
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

// ─── 套餐 CRUD ────────────────────────────────────────────────────────────────

/**
 * 获取全部套餐列表，按 sort_order 升序排列。
 *
 * @returns {Promise<object[]>}
 */
async function listPlans() {
  const rows = await query(
    `SELECT
       id, code, name, description, billing_mode, quota_period,
       request_quota, token_quota, priority_weight, concurrency_limit,
       max_output_tokens, plan_models_json, status, is_default, sort_order
     FROM plans
     ORDER BY sort_order ASC, id ASC`,
  );
  return hydratePlanModelsForPlans(rows);
}

/**
 * 按 ID 查询单个套餐。
 *
 * @param {number} planId
 * @returns {Promise<object | null>}
 */
async function findPlanById(planId) {
  const rows = await query(
    `SELECT
       id, code, name, description, billing_mode, quota_period,
       request_quota, token_quota, priority_weight, concurrency_limit,
       max_output_tokens, plan_models_json, status, is_default, sort_order
     FROM plans
     WHERE id = ?
     LIMIT 1`,
    [planId],
  );
  return hydratePlanModelsForPlan(rows[0] || null);
}

/**
 * 新建套餐。若 isDefault=true，同时清除其他套餐的默认标记。
 *
 * @param {object} payload  套餐字段，code 和 name 必填
 * @returns {Promise<number>} 新套餐 ID
 */
async function createPlan(payload) {
  const normalized = normalizePlanPayload(payload);

  const result = await query(
    `INSERT INTO plans (
       code, name, description, billing_mode, quota_period,
       request_quota, token_quota, priority_weight, concurrency_limit,
       max_output_tokens, plan_models_json, status, is_default, sort_order,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      String(payload.code || '').trim(),
      String(payload.name || '').trim(),
      String(payload.description || '').trim() || null,
      normalized.billingMode,
      normalized.quotaPeriod,
      normalized.requestQuota,
      normalized.tokenQuota,
      normalized.priorityWeight,
      normalized.concurrencyLimit,
      normalized.maxOutputTokens,
      serializePlanModels(normalized.planModels),
      normalized.status,
      normalized.isDefault ? 1 : 0,
      normalized.sortOrder,
    ],
  );

  if (payload.isDefault) {
    // 在事务内原子地完成「清除旧默认 → 设置新默认」，避免并发读时出现零个默认套餐的窗口期
    await withTransaction(async (conn) => {
      await conn.execute('UPDATE plans SET is_default = 0, updated_at = NOW() WHERE id <> ?', [result.insertId]);
      await conn.execute('UPDATE plans SET is_default = 1, updated_at = NOW() WHERE id = ?', [result.insertId]);
    });
  }

  return result.insertId;
}

/**
 * 更新套餐信息。未传的字段保留旧值。
 *
 * @param {number} planId
 * @param {object} payload  需要更新的字段
 * @returns {Promise<void>}
 */
async function updatePlan(planId, payload) {
  const current = await findPlanById(planId);
  if (!current) throw new Error('Plan not found');

  const normalized = normalizePlanPayload(payload, current);

  await query(
    `UPDATE plans
     SET name = ?,
         description = ?,
         billing_mode = ?,
         quota_period = ?,
         request_quota = ?,
         token_quota = ?,
         priority_weight = ?,
         concurrency_limit = ?,
         max_output_tokens = ?,
         plan_models_json = ?,
         status = ?,
         is_default = ?,
         sort_order = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      String(payload.name || current.name).trim(),
      String(payload.description || current.description || '').trim() || null,
      normalized.billingMode,
      normalized.quotaPeriod,
      normalized.requestQuota,
      normalized.tokenQuota,
      normalized.priorityWeight,
      normalized.concurrencyLimit,
      normalized.maxOutputTokens,
      serializePlanModels(normalized.planModels),
      normalized.status,
      normalized.isDefault ? 1 : 0,
      normalized.sortOrder,
      planId,
    ],
  );

  if (payload.isDefault) {
    await withTransaction(async (conn) => {
      await conn.execute('UPDATE plans SET is_default = 0, updated_at = NOW() WHERE id <> ?', [planId]);
      await conn.execute('UPDATE plans SET is_default = 1, updated_at = NOW() WHERE id = ?', [planId]);
    });
  }
}

/**
 * 删除套餐。若套餐被任何订阅引用（历史或当前），拒绝删除并抛出 'PLAN_IN_USE'。
 *
 * @param {number} planId
 * @returns {Promise<void>}
 * @throws {Error} 'PLAN_IN_USE'
 */
async function deletePlan(planId) {
  const rows = await query(
    'SELECT COUNT(*) AS ref_count FROM user_subscriptions WHERE plan_id = ?',
    [planId],
  );

  if (Number(rows[0]?.ref_count || 0) > 0) {
    throw new Error('PLAN_IN_USE');
  }

  await query('DELETE FROM plans WHERE id = ?', [planId]);
}

// ─── 订阅 & 配额查询 ──────────────────────────────────────────────────────────

/**
 * 获取用户当前活跃订阅（含关联套餐信息）。
 *
 * @param {number} userId
 * @returns {Promise<object | null>}
 */
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

/**
 * 统计用户在当前计费周期内的已用请求次数与 token 数。
 *
 * @param {number} userId
 * @param {object|null} [subscription]  可传入已查询的订阅以避免重复查询
 * @returns {Promise<{ usedRequests: number, usedTokens: number }>}
 */
async function getCurrentUsageForUser(userId, subscription = null) {
  const activeSubscription = subscription || await getActiveSubscriptionForUser(userId);
  if (!activeSubscription) {
    return { usedRequests: 0, usedTokens: 0 };
  }

  const sinceClause = buildUsageSinceClause(activeSubscription);

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
    usedTokens:   Number(rows[0]?.used_tokens   || 0),
  };
}

/**
 * 获取用户配额快照：订阅信息、已用量、剩余配额。
 *
 * @param {number} userId
 * @returns {Promise<{
 *   subscription: object,
 *   usage: { usedRequests: number, usedTokens: number },
 *   remainingRequests: number,
 *   remainingTokens: number
 * } | null>}
 */
async function getUserQuotaSnapshot(userId) {
  const subscription = await getActiveSubscriptionForUser(userId);
  if (!subscription) return null;

  const usage = await getCurrentUsageForUser(userId, subscription);

  return {
    subscription,
    usage,
    remainingRequests: Math.max(0, Number(subscription.request_quota || 0) - usage.usedRequests),
    remainingTokens:   Math.max(0, Number(subscription.token_quota   || 0) - usage.usedTokens),
  };
}

/**
 * 校验用户是否有足够的配额发起下一次 LLM 请求。
 * 配额不足时抛出特定错误码，由 error-handler 捕获并返回 429。
 *
 * @param {number} userId
 * @param {number} [estimatedTokens=0]  预估本次请求消耗的 token 数（per_token 模式使用）
 * @returns {Promise<object>} 配额快照
 * @throws {Error} 'REQUEST_QUOTA_EXCEEDED' 或 'TOKEN_QUOTA_EXCEEDED'
 */
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
    enabled: true,
    requestMultiplier: item.requestMultiplier,
    tokenMultiplier: item.tokenMultiplier,
    providerId: item.providerId,
    displayName: item.label,
    hiddenModelId: item.modelId,
    isDefault: item.isDefault,
  }));
}

/**
 * 变更用户套餐：在事务内将旧订阅标记为 expired，并创建新的 active 订阅。
 *
 * @param {number} userId
 * @param {number} planId  目标套餐 ID
 * @returns {Promise<void>}
 */
async function updateUserPlan(userId, planId) {
  await withTransaction(async (conn) => {
    // 将当前活跃订阅标记为已到期
    await conn.execute(
      `UPDATE user_subscriptions
       SET status = 'expired', ended_at = NOW(), updated_at = NOW()
       WHERE user_id = ? AND status = 'active'`,
      [userId],
    );

    // 创建新的活跃订阅
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
