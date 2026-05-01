/**
 * @file src/services/plan/crud.js
 * @description 套餐 CRUD 与默认套餐切换逻辑，保留原 SQL 行为。
 */

const { query, withTransaction } = require('../../lib/db');
const { serializePlanModels } = require('../model-entitlement-service');
const { normalizePlanPayload } = require('./normalizer');
const { hydratePlanModelsForPlan, hydratePlanModelsForPlans } = require('./hydration');

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
    await withTransaction(async (conn) => {
      await conn.execute('UPDATE plans SET is_default = 0, updated_at = NOW() WHERE id <> ?', [result.insertId]);
      await conn.execute('UPDATE plans SET is_default = 1, updated_at = NOW() WHERE id = ?', [result.insertId]);
    });
  }

  return result.insertId;
}

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

module.exports = {
  listPlans,
  findPlanById,
  createPlan,
  updatePlan,
  deletePlan,
};
