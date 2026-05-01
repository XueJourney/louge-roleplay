/**
 * @file src/services/plan/normalizer.js
 * @description 套餐载荷归一化与数值字段强校验，避免后台表单脏值进入服务层。
 */

const { parsePlanModelsJson } = require('../model-entitlement-service');

function ensureNonNegativeInteger(value, fieldLabel, fallback = 0) {
  const normalized = Number(value ?? fallback);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${fieldLabel} must be a non-negative integer`);
  }
  return normalized;
}

function ensurePositiveInteger(value, fieldLabel, fallback = 1) {
  const normalized = Number(value ?? fallback);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error(`${fieldLabel} must be a positive integer`);
  }
  return normalized;
}

function normalizePlanPayload(payload = {}, current = null) {
  const billingMode = String(payload.billingMode || current?.billing_mode || 'per_request').trim();
  const quotaPeriod = String(payload.quotaPeriod || current?.quota_period || 'monthly').trim();
  const status = String(payload.status || current?.status || 'active').trim();

  const requestQuotaInput = payload.requestQuota ?? current?.request_quota ?? 0;
  const tokenQuotaInput = payload.tokenQuota ?? current?.token_quota ?? 0;

  return {
    billingMode,
    quotaPeriod,
    status,
    requestQuota: billingMode === 'per_token' ? 0 : ensureNonNegativeInteger(requestQuotaInput, 'requestQuota'),
    tokenQuota: billingMode === 'per_request' ? 0 : ensureNonNegativeInteger(tokenQuotaInput, 'tokenQuota'),
    priorityWeight: ensureNonNegativeInteger(payload.priorityWeight ?? current?.priority_weight ?? 0, 'priorityWeight'),
    concurrencyLimit: ensurePositiveInteger(payload.concurrencyLimit ?? current?.concurrency_limit ?? 1, 'concurrencyLimit'),
    maxOutputTokens: ensurePositiveInteger(payload.maxOutputTokens ?? current?.max_output_tokens ?? 1024, 'maxOutputTokens'),
    sortOrder: ensureNonNegativeInteger(payload.sortOrder ?? current?.sort_order ?? 0, 'sortOrder'),
    isDefault: Boolean(payload.isDefault),
    planModels: Array.isArray(payload.planModels) ? payload.planModels : parsePlanModelsJson(current?.plan_models_json || '[]'),
  };
}

module.exports = {
  ensureNonNegativeInteger,
  ensurePositiveInteger,
  normalizePlanPayload,
};
