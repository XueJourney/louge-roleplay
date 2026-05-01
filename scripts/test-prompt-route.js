#!/usr/bin/env node
/**
 * @file scripts/test-prompt-route.js
 * @description
 * Prompt 路由/LLM 网关的轻量单元测试。
 *
 * 调用说明：
 * - `npm run test:prompt-route` 执行。
 * - 通过 monkey patch Module._load 隔离外部依赖，只验证 prompt 构造与路由调用契约。
 */
'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '../lib/logger') {
    return { info() {}, warn() {}, error() {}, debug() {} };
  }
  if (request === './plan-service') {
    return {
      getActiveSubscriptionForUser: async () => ({
        plan_id: 1,
        billing_mode: 'per_request',
        request_quota: 100,
        token_quota: 0,
        priority_weight: 0,
        max_output_tokens: 1024,
        planModels: [{
          modelKey: 'standard',
          label: '标准模型',
          providerId: 1,
          modelId: 'test-model',
          requestMultiplier: 1,
          tokenMultiplier: 1,
          isDefault: true,
          sortOrder: 0,
        }],
      }),
      getSubscriptionModelConfig: () => ({
        modelKey: 'standard',
        label: '标准模型',
        providerId: 1,
        modelId: 'test-model',
        requestMultiplier: 1,
        tokenMultiplier: 1,
        isDefault: true,
      }),
      buildPlanModelOptions: () => [{ mode: 'standard', label: '标准模型', enabled: true }],
      assertUserQuotaAvailable: async () => {},
    };
  }
  if (request === './llm-provider-service') {
    return {
      getActiveProvider: async () => ({
        id: 1,
        provider_type: 'openai_compatible',
        base_url: 'https://example.invalid',
        api_key: 'test-key',
        standard_model: 'test-model',
        model: 'test-model',
        max_context_tokens: 81920,
        trim_context_tokens: 61440,
        available_models_json: '[]',
      }),
      getProviderById: async () => ({
        id: 1,
        name: 'Test Provider',
        provider_type: 'openai_compatible',
        base_url: 'https://example.invalid',
        api_key: 'test-key',
        standard_model: 'test-model',
        model: 'test-model',
        max_context_tokens: 81920,
        trim_context_tokens: 61440,
        available_models_json: '["test-model"]',
      }),
      listProviders: async () => [{
        id: 1,
        name: 'Test Provider',
        provider_type: 'openai_compatible',
        base_url: 'https://example.invalid',
        api_key: 'test-key',
        standard_model: 'test-model',
        model: 'test-model',
        max_context_tokens: 81920,
        trim_context_tokens: 61440,
        available_models_json: '["test-model"]',
        availableModels: [{ id: 'test-model', label: 'Test Model' }],
      }],
      buildModelOptions: () => [],
    };
  }
  if (request === './llm-usage-service') {
    return {
      createLlmJob: async () => 1,
      updateLlmJob: async () => {},
      createUsageLog: async () => {},
    };
  }
  if (request === './prompt-engineering-service') {
    return {
      listPromptBlocks: async () => [],
      buildCharacterPromptItems: (character) => [
        { key: '角色名', value: character.name || '', sortOrder: 0, isEnabled: true },
      ],
      composeSystemPrompt: ({ characterPromptItems }) => characterPromptItems.map((item) => `${item.key}:${item.value}`).join('\n'),
      applyRuntimeTemplate: (text) => String(text || ''),
      applyRuntimeTemplateToCharacter: (character) => character,
      formatRuntimeTime: () => '2026年04月25日 星期六 18:00:00 GMT+08:00',
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const captured = [];
global.fetch = async (url, options) => {
  captured.push(JSON.parse(options.body));
  return {
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
  };
};

const { generateReplyViaGateway } = require('../src/services/llm-gateway-service');

async function main() {
  await generateReplyViaGateway({
    requestId: 'test-dup',
    userId: 1,
    conversationId: 1,
    character: { name: '测试角色' },
    messages: [
      { sender_type: 'user', content: '你好' },
      { sender_type: 'character', content: '<think>hidden</think>嗨。' },
      { sender_type: 'user', content: '继续' },
    ],
    userMessage: '继续',
    user: { username: 'tester' },
  });

  assert.equal(captured.length, 1);
  const promptMessages = captured[0].messages;
  assert.deepEqual(promptMessages.map((item) => item.role), ['system', 'user', 'assistant', 'user']);
  assert.deepEqual(promptMessages.map((item) => item.content), ['角色名:测试角色', '你好', '嗨。', '继续']);
  assert.equal(promptMessages.filter((item) => item.role === 'user' && item.content === '继续').length, 1);
  console.log('[prompt-route-test] pass: last user message is not duplicated and think tags are stripped.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
