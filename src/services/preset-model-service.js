/**
 * @file src/services/preset-model-service.js
 * @description Admin-managed preset model catalog used by plans.
 */

'use strict';

const { query } = require('../lib/db');
const { normalizeModelKey } = require('./model-entitlement-service');

function normalizePresetDescription(value = '') {
  return String(value || '').trim().slice(0, 1000);
}

function buildPresetModelLabel(modelId = '') {
  const tail = String(modelId || '').split('/').pop() || 'model';
  return tail
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizePresetPayload(payload = {}, current = null) {
  const providerId = Number(payload.providerId ?? payload.provider_id ?? current?.provider_id ?? 0);
  const modelId = String(payload.modelId ?? payload.model_id ?? current?.model_id ?? '').trim();
  const name = String(payload.name ?? current?.name ?? '').trim() || buildPresetModelLabel(modelId);
  const modelKey = normalizeModelKey(payload.modelKey ?? payload.model_key ?? current?.model_key ?? name, 'model');
  const description = normalizePresetDescription(payload.description ?? current?.description ?? '');
  const status = String(payload.status ?? current?.status ?? 'active').trim() === 'disabled' ? 'disabled' : 'active';
  const sortOrder = Number(payload.sortOrder ?? payload.sort_order ?? current?.sort_order ?? 0);

  if (!Number.isSafeInteger(providerId) || providerId <= 0) {
    throw new Error('PRESET_MODEL_PROVIDER_REQUIRED');
  }
  if (!modelId) {
    throw new Error('PRESET_MODEL_ID_REQUIRED');
  }
  if (!name) {
    throw new Error('PRESET_MODEL_NAME_REQUIRED');
  }

  return {
    providerId,
    modelId,
    modelKey,
    name,
    description,
    status,
    sortOrder: Number.isSafeInteger(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
  };
}

function parsePresetModelMetadata(raw = '') {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function normalizePresetRow(row = {}) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id || 0),
    provider_id: Number(row.provider_id || 0),
    sort_order: Number(row.sort_order || 0),
    metadata: parsePresetModelMetadata(row.metadata_json || '{}'),
  };
}

async function listPresetModels({ includeDisabled = true } = {}) {
  const rows = await query(
    `SELECT
       pm.id, pm.provider_id, pm.model_key, pm.model_id, pm.name, pm.description,
       pm.status, pm.sort_order, pm.metadata_json, pm.created_at, pm.updated_at,
       lp.name AS provider_name, lp.status AS provider_status, lp.is_active AS provider_is_active
     FROM preset_models pm
     LEFT JOIN llm_providers lp ON lp.id = pm.provider_id
     ${includeDisabled ? '' : "WHERE pm.status = 'active'"}
     ORDER BY pm.sort_order ASC, pm.id ASC`,
  );
  return rows.map(normalizePresetRow).filter(Boolean);
}

async function findPresetModelById(modelId, { activeOnly = false } = {}) {
  const rows = await query(
    `SELECT
       pm.id, pm.provider_id, pm.model_key, pm.model_id, pm.name, pm.description,
       pm.status, pm.sort_order, pm.metadata_json, pm.created_at, pm.updated_at,
       lp.name AS provider_name, lp.status AS provider_status, lp.is_active AS provider_is_active
     FROM preset_models pm
     LEFT JOIN llm_providers lp ON lp.id = pm.provider_id
     WHERE pm.id = ?${activeOnly ? " AND pm.status = 'active'" : ''}
     LIMIT 1`,
    [modelId],
  );
  return normalizePresetRow(rows[0] || null);
}

async function createPresetModel(payload) {
  const normalized = normalizePresetPayload(payload);
  const result = await query(
    `INSERT INTO preset_models (
       provider_id, model_key, model_id, name, description, status, sort_order, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      normalized.providerId,
      normalized.modelKey,
      normalized.modelId,
      normalized.name,
      normalized.description || null,
      normalized.status,
      normalized.sortOrder,
      JSON.stringify({}),
    ],
  );
  return result.insertId;
}

async function updatePresetModel(modelId, payload) {
  const current = await findPresetModelById(modelId);
  if (!current) throw new Error('PRESET_MODEL_NOT_FOUND');
  const normalized = normalizePresetPayload(payload, current);
  await query(
    `UPDATE preset_models
     SET provider_id = ?,
         model_key = ?,
         model_id = ?,
         name = ?,
         description = ?,
         status = ?,
         sort_order = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      normalized.providerId,
      normalized.modelKey,
      normalized.modelId,
      normalized.name,
      normalized.description || null,
      normalized.status,
      normalized.sortOrder,
      modelId,
    ],
  );
}

async function deletePresetModel(modelId) {
  const refs = await query(
    `SELECT id, name, plan_models_json
     FROM plans
     WHERE plan_models_json LIKE ?`,
    [`%"presetModelId":${Number(modelId)}%`],
  );
  const referenced = refs.some((plan) => {
    try {
      const items = JSON.parse(String(plan.plan_models_json || '[]'));
      return Array.isArray(items) && items.some((item) => Number(item.presetModelId || item.preset_model_id || 0) === Number(modelId));
    } catch (_) {
      return false;
    }
  });
  if (referenced) {
    throw new Error('PRESET_MODEL_IN_USE');
  }
  await query('DELETE FROM preset_models WHERE id = ?', [modelId]);
}


module.exports = {
  normalizePresetPayload,
  listPresetModels,
  findPresetModelById,
  createPresetModel,
  updatePresetModel,
  deletePresetModel,
};
