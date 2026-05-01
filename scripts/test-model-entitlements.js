/**
 * @file scripts/test-model-entitlements.js
 * @description Focused tests for plan model entitlement normalization and admin form parsing.
 */

'use strict';

const assert = require('node:assert/strict');
const {
  normalizePlanModels,
  serializePlanModels,
  parsePlanModelsJson,
  findPlanModel,
  getBillableRequestUnits,
  getBillableTokenUnits,
} = require('../src/services/model-entitlement-service');
const { parsePlanModelsFromBody } = require('../src/services/model-form-service');

function testNormalizationAndBilling() {
  const models = normalizePlanModels([
    { modelKey: 'Premium Model!!', label: '高级模型', providerId: '2', modelId: 'vendor/premium', requestMultiplier: '3', tokenMultiplier: '3', isDefault: false, sortOrder: 20 },
    { modelKey: 'standard', label: '基础模型', providerId: '1', modelId: 'vendor/basic', requestMultiplier: '1', tokenMultiplier: '1', isDefault: true, sortOrder: 10 },
    { modelKey: 'standard', label: '重复基础', providerId: '1', modelId: 'vendor/duplicate' },
  ]);

  assert.equal(models.length, 2);
  assert.equal(models[0].modelKey, 'standard');
  assert.equal(models[0].isDefault, true);
  assert.equal(models[1].modelKey, 'premium-model');
  assert.equal(models[1].requestMultiplier, 3);
  assert.equal(models[1].tokenMultiplier, 3);
  assert.equal(getBillableRequestUnits(models[1]), 3);
  assert.equal(getBillableTokenUnits(101, models[1]), 303);
}

function testSerializationAndFallback() {
  const serialized = serializePlanModels([
    { presetModelId: 1, modelKey: 'standard', label: '基础', description: '基础模型描述', providerId: 1, modelId: 'basic', isDefault: true },
    { presetModelId: 2, modelKey: 'premium', label: '高级', providerId: 1, modelId: 'premium', requestMultiplier: 2.5, tokenMultiplier: 3 },
  ]);
  const parsed = parsePlanModelsJson(serialized);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].presetModelId, 1);
  assert.equal(parsed[0].description, '基础模型描述');
  assert.equal(findPlanModel(parsed, 'premium').modelId, 'premium');
  assert.equal(findPlanModel(parsed, 'missing').modelKey, 'standard');
}

function testFormParsing() {
  const presetModels = [
    { id: 1, model_key: 'standard', name: '基础模型', description: '稳', provider_id: 1, model_id: 'basic-model', status: 'active' },
    { id: 2, model_key: 'premium', name: '高级模型', description: '强', provider_id: 2, model_id: 'premium-model', status: 'active' },
  ];
  const parsed = parsePlanModelsFromBody({
    planModelPresetId: ['1', '2', ''],
    planModelRequestMultiplier: ['1', '3', '1'],
    planModelTokenMultiplier: ['1', '3', '1'],
    planModelDefaultPresetId: '2',
  }, presetModels);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].presetModelId, 1);
  assert.equal(parsed[0].modelKey, 'standard');
  assert.equal(parsed[0].description, '稳');
  assert.equal(parsed[0].isDefault, false);
  assert.equal(parsed[1].presetModelId, 2);
  assert.equal(parsed[1].modelKey, 'premium');
  assert.equal(parsed[1].isDefault, true);
  assert.equal(parsed[1].providerId, 2);
  assert.equal(parsed[1].requestMultiplier, 3);
}

testNormalizationAndBilling();
testSerializationAndFallback();
testFormParsing();
console.log('model entitlement tests passed');
