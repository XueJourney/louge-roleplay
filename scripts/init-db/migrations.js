'use strict';

const {
  buildPresetModelLabel,
  getRandomDigits,
  mergePresetLabels,
  normalizeModelKey,
} = require('./utils');

async function migratePresetModelsFromPlans(connection) {
  const [presetRows] = await connection.query('SELECT id, provider_id, model_id FROM preset_models');
  const existingBySignature = new Map((presetRows || []).map((preset) => [`${Number(preset.provider_id || 0)}::${String(preset.model_id || '').trim()}`, preset]));
  const [plans] = await connection.query('SELECT id, plan_models_json FROM plans ORDER BY id ASC');
  const groups = new Map();

  (plans || []).forEach((plan) => {
    let items = [];
    try {
      const parsed = JSON.parse(String(plan.plan_models_json || '[]'));
      items = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      items = [];
    }
    items.forEach((item) => {
      const providerId = Number(item.providerId ?? item.provider_id ?? 0);
      const modelId = String(item.modelId ?? item.model_id ?? '').trim();
      if (!providerId || !modelId) return;
      const signature = `${providerId}::${modelId}`;
      if (!groups.has(signature)) {
        groups.set(signature, { providerId, modelId, modelKeys: [], labels: [], descriptions: [], planIds: [] });
      }
      const group = groups.get(signature);
      group.modelKeys.push(item.modelKey ?? item.model_key ?? '');
      group.labels.push(item.label ?? item.name ?? '');
      group.descriptions.push(item.description ?? item.modelDescription ?? item.model_description ?? '');
      group.planIds.push(Number(plan.id));
    });
  });

  let created = 0;
  let updatedPlans = 0;

  for (const group of groups.values()) {
    const signature = `${group.providerId}::${group.modelId}`;
    if (existingBySignature.has(signature)) continue;
    const name = mergePresetLabels(group.labels, buildPresetModelLabel(group.modelId));
    const [result] = await connection.query(
      `INSERT INTO preset_models (
         provider_id, model_key, model_id, name, description, status, sort_order, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'active', 0, ?, NOW(), NOW())`,
      [
        group.providerId,
        normalizeModelKey(group.modelKeys.find(Boolean) || name || group.modelId),
        group.modelId,
        name,
        mergePresetLabels(group.descriptions, '') || null,
        JSON.stringify({ migratedFromPlanIds: [...new Set(group.planIds)] }),
      ],
    );
    existingBySignature.set(signature, { id: result.insertId, provider_id: group.providerId, model_id: group.modelId });
    created += 1;
  }

  const [freshPresetRows] = await connection.query('SELECT id, provider_id, model_id FROM preset_models');
  const freshBySignature = new Map((freshPresetRows || []).map((preset) => [`${Number(preset.provider_id || 0)}::${String(preset.model_id || '').trim()}`, preset]));

  for (const plan of plans || []) {
    let items = [];
    try {
      const parsed = JSON.parse(String(plan.plan_models_json || '[]'));
      items = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      items = [];
    }
    let changed = false;
    const migrated = items.map((item) => {
      const providerId = Number(item.providerId ?? item.provider_id ?? 0);
      const modelId = String(item.modelId ?? item.model_id ?? '').trim();
      const preset = freshBySignature.get(`${providerId}::${modelId}`);
      if (!preset || Number(item.presetModelId || item.preset_model_id || 0) === Number(preset.id)) return item;
      changed = true;
      return { ...item, presetModelId: Number(preset.id) };
    });
    if (changed) {
      await connection.query('UPDATE plans SET plan_models_json = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(migrated), plan.id]);
      updatedPlans += 1;
    }
  }

  return { created, updatedPlans };
}

async function backfillUserPublicIds(connection) {
  const [users] = await connection.query("SELECT id FROM users WHERE public_id IS NULL OR public_id = '' ORDER BY id ASC");
  if (!users.length) {
    return;
  }

  const exists = async (candidate) => {
    const [rows] = await connection.query('SELECT id FROM users WHERE public_id = ? LIMIT 1', [candidate]);
    return rows.length > 0;
  };

  for (const user of users) {
    let publicId = '';
    for (let digits = 3; !publicId; digits += 1) {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const candidate = getRandomDigits(digits);
        // eslint-disable-next-line no-await-in-loop
        if (!(await exists(candidate))) {
          publicId = candidate;
          break;
        }
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await connection.query('UPDATE users SET public_id = ?, updated_at = NOW() WHERE id = ?', [publicId, user.id]);
  }

  console.log(`[init-db]   + 已为 ${users.length} 个历史用户补齐公开 ID`);
}

module.exports = {
  migratePresetModelsFromPlans,
  backfillUserPublicIds,
};
