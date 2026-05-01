/**
 * @file src/services/llm-gateway-service.js
 * @description 统一 LLM 调用入口：套餐、优先级、并发控制、provider 配置、用量记录。
 */

const logger = require('../lib/logger');
const { getActiveSubscriptionForUser, assertUserQuotaAvailable } = require('./plan-service');
const { getActiveProvider, buildModelOptions } = require('./llm-provider-service');
const { createLlmJob, updateLlmJob, createUsageLog } = require('./llm-usage-service');
const { listPromptBlocks, buildCharacterPromptItems, composeSystemPrompt, applyRuntimeTemplate, applyRuntimeTemplateToCharacter, formatRuntimeTime } = require('./prompt-engineering-service');
const {
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_TRIM_CONTEXT_TOKENS,
  estimateTokens,
  estimatePromptTokens,
  normalizeMessageRole,
  normalizeTextContent,
  stripThinkTags,
  extractReasoningText,
  extractMessageContent,
  combineReplyContent,
  shouldAppendUserMessage,
  buildSummaryTranscript,
  trimMessagesForContext,
} = require('./llm-gateway/content-utils');
const { DEFAULT_MAX_GLOBAL_CONCURRENCY: MAX_GLOBAL_CONCURRENCY, createPriorityQueue } = require('./llm-gateway/priority-queue');
const { callProvider, callProviderStream } = require('./llm-gateway/provider-client');

const llmQueue = createPriorityQueue({ maxConcurrency: MAX_GLOBAL_CONCURRENCY, log: logger });

function buildRuntimeContext({ user = null, now = new Date() } = {}) {
  const username = String(user?.username || user?.name || user?.user || '').trim() || '用户';
  return {
    user: username,
    username,
    now,
    timeZone: 'Asia/Hong_Kong',
    time: formatRuntimeTime(now, { timeZone: 'Asia/Hong_Kong' }),
  };
}

function getProviderModelId(provider, modelMode = 'standard') {
  const normalizedMode = String(modelMode || 'standard').trim();
  if (normalizedMode === 'force_jailbreak') {
    return String(provider.force_jailbreak_model || provider.jailbreak_model || provider.standard_model || provider.model || '').trim();
  }
  if (normalizedMode === 'jailbreak') {
    return String(provider.jailbreak_model || provider.standard_model || provider.model || '').trim();
  }
  if (normalizedMode === 'compression') {
    return String(provider.compression_model || provider.standard_model || provider.model || '').trim();
  }
  return String(provider.standard_model || provider.model || '').trim();
}

function buildModelModeOptions(provider) {
  const availableModelIds = new Set((provider?.availableModels || []).map((item) => item.id));
  const findModel = (modelId) => (provider?.availableModels || []).find((item) => item.id === modelId);
  const buildOption = (mode, label, modelId) => {
    const matched = findModel(modelId);
    return {
      mode,
      label,
      enabled: Boolean(modelId),
      hiddenModelId: modelId || '',
      displayName: matched?.label || label,
      searchableText: (matched?.searchText || `${label} ${modelId || ''}`).trim(),
      inDiscoveryList: modelId ? availableModelIds.has(modelId) : false,
    };
  };

  return [
    buildOption('standard', '标准对话模型', getProviderModelId(provider, 'standard')),
    buildOption('jailbreak', '破限模型', getProviderModelId(provider, 'jailbreak')),
    buildOption('force_jailbreak', '强制破限模型', getProviderModelId(provider, 'force_jailbreak')),
  ].filter((item) => item.enabled);
}

async function summarizeDiscardedMessages(provider, discardedMessages = []) {
  if (!discardedMessages.length) {
    return '';
  }

  const transcript = buildSummaryTranscript(discardedMessages.map((message) => ({
    sender_type: message.role === 'user' ? 'user' : 'character',
    content: message.content,
  })));

  const compressionPrompt = [
    {
      role: 'system',
      content: '请压缩总结被舍弃的历史对话，保留人物关系、事件进展、关键约定、情绪状态与未完成事项。输出简洁中文摘要，不要解释。',
    },
    {
      role: 'user',
      content: `请总结对话\n${transcript}`,
    },
  ];

  const result = await callProvider(provider, compressionPrompt, 600, 'compression');
  return String(result.content || '').trim();
}

async function buildPromptMessages({ provider, character, messages, userMessage, systemHint = '', runtimeContext = {} }) {
  const promptBlocks = await listPromptBlocks({ enabledOnly: true });
  const runtimeCharacter = applyRuntimeTemplateToCharacter(character, runtimeContext);
  const systemPrompt = composeSystemPrompt({
    promptBlocks: promptBlocks.map((item) => ({
      key: item.block_key,
      value: item.block_value,
      sortOrder: item.sort_order,
      isEnabled: item.is_enabled,
    })),
    characterPromptItems: buildCharacterPromptItems(runtimeCharacter),
    systemHint,
    runtimeContext,
  });

  const historyPromptMessages = messages
    .map((message) => ({
      role: normalizeMessageRole(message),
      content: stripThinkTags(message.content),
    }))
    .filter((message) => message.content);
  const normalizedUserMessage = stripThinkTags(userMessage);

  const initialMessages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    ...historyPromptMessages,
    ...(shouldAppendUserMessage(messages, userMessage) ? [{ role: 'user', content: normalizedUserMessage }] : []),
  ];

  const trimmed = trimMessagesForContext(initialMessages, provider);
  if (!trimmed.discardedMessages.length) {
    return trimmed;
  }

  const summary = await summarizeDiscardedMessages(provider, trimmed.discardedMessages);
  if (!summary) {
    return trimmed;
  }

  const mergedPromptMessages = [...trimmed.promptMessages];
  const insertionIndex = mergedPromptMessages.findIndex((item) => item.role !== 'system');
  const summaryMessage = {
    role: 'user',
    content: `user:请总结对话 AI:${summary}`,
  };

  if (insertionIndex === -1) {
    mergedPromptMessages.push(summaryMessage);
  } else {
    mergedPromptMessages.splice(insertionIndex, 0, summaryMessage);
  }

  return {
    ...trimmed,
    promptMessages: mergedPromptMessages,
    summaryInserted: true,
    summary,
  };
}


async function executeLlmRequest({ requestId, userId, conversationId = null, character, messages, userMessage, systemHint = '', promptKind = 'chat', modelMode = 'standard', user = null }) {
  const subscription = await getActiveSubscriptionForUser(userId);
  if (!subscription) {
    throw new Error('User plan is not configured');
  }

  const provider = await getActiveProvider();
  if (!provider) {
    logger.warn('LLM provider unavailable; fallback reply generated', {
      requestId,
      userId,
      conversationId,
      promptKind,
    });
    const fallbackPromptMessages = [{ role: 'user', content: String(userMessage || '') }];
    return {
      content: `${character.name} 看着你，轻声说：我听见你说“${String(userMessage || '').slice(0, 120)}”。现在后台还没配置可用的 LLM provider，所以我先陪你把流程跑通。`,
      usage: {
        inputTokens: estimatePromptTokens(fallbackPromptMessages),
        outputTokens: estimateTokens(userMessage || ''),
        totalTokens: estimatePromptTokens(fallbackPromptMessages) + estimateTokens(userMessage || ''),
        totalCost: 0,
        latencyMs: 0,
      },
      provider: null,
      plan: subscription,
      modelMode,
      modelOptions: [],
    };
  }

  provider.availableModels = buildModelOptions((() => {
    try {
      return JSON.parse(provider.available_models_json || '[]');
    } catch (error) {
      return [];
    }
  })());

  const runtimeContext = buildRuntimeContext({ user });
  const promptBuild = await buildPromptMessages({ provider, character, messages, userMessage, systemHint, runtimeContext });
  const promptMessages = promptBuild.promptMessages;
  const estimatedTokens = estimatePromptTokens(promptMessages) + Number(subscription.max_output_tokens || 0);
  await assertUserQuotaAvailable(userId, estimatedTokens);

  const jobId = await createLlmJob({
    requestId,
    userId,
    conversationId,
    providerId: provider.id,
    priority: Number(subscription.priority_weight || 0),
    status: 'queued',
    promptKind,
  });

  return {
    subscription,
    provider,
    promptBuild,
    promptMessages,
    jobId,
  };
}

async function finalizeLlmJobSuccess({ jobId, startedAt, provider, subscription, requestId, userId, conversationId, promptKind, result, modelMode, promptBuild }) {
  const totalCost = (
    (Number(result.inputTokens || 0) / 1000) * Number(provider.input_token_price || 0)
    + (Number(result.outputTokens || 0) / 1000) * Number(provider.output_token_price || 0)
  );

  await updateLlmJob(jobId, {
    providerId: provider.id,
    status: 'success',
    startedAt,
    finishedAt: new Date(),
  });

  await createUsageLog({
    requestId,
    userId,
    conversationId,
    providerId: provider.id,
    planId: subscription.plan_id,
    promptKind,
    status: 'success',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens,
    totalCost,
    latencyMs: result.latencyMs,
  });

  return {
    content: result.content,
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      totalCost,
      latencyMs: result.latencyMs,
    },
    provider,
    plan: subscription,
    modelMode,
    modelOptions: buildModelModeOptions(provider),
    contextMeta: {
      maxContextTokens: promptBuild.maxContextTokens,
      trimContextTokens: promptBuild.trimContextTokens,
      summaryInserted: promptBuild.summaryInserted,
    },
  };
}

async function finalizeLlmJobFailure({ jobId, startedAt, provider, subscription, requestId, userId, conversationId, promptKind, error }) {
  logger.error('LLM gateway request failed', {
    requestId,
    userId,
    providerId: provider.id,
    error: error.message,
  });

  await updateLlmJob(jobId, {
    providerId: provider.id,
    status: 'failed',
    startedAt,
    finishedAt: new Date(),
    errorMessage: error.message,
  });

  await createUsageLog({
    requestId,
    userId,
    conversationId,
    providerId: provider.id,
    planId: subscription.plan_id,
    promptKind,
    status: 'failed',
    errorMessage: error.message,
  });
}

async function executeLlmQueued(requestMeta, runner) {
  const prepared = await executeLlmRequest(requestMeta);
  if (!prepared.provider) {
    return prepared;
  }
  const { subscription, provider, promptBuild, promptMessages, jobId } = prepared;
  return llmQueue.enqueueWithPriority(async () => {
    const startedAt = new Date();
    await updateLlmJob(jobId, {
      providerId: provider.id,
      status: 'running',
      startedAt,
    });

    try {
      const result = await runner({ provider, promptMessages, subscription, promptBuild });
      return await finalizeLlmJobSuccess({
        jobId,
        startedAt,
        provider,
        subscription,
        requestId: requestMeta.requestId,
        userId: requestMeta.userId,
        conversationId: requestMeta.conversationId,
        promptKind: requestMeta.promptKind,
        result,
        modelMode: requestMeta.modelMode,
        promptBuild,
      });
    } catch (error) {
      await finalizeLlmJobFailure({
        jobId,
        startedAt,
        provider,
        subscription,
        requestId: requestMeta.requestId,
        userId: requestMeta.userId,
        conversationId: requestMeta.conversationId,
        promptKind: requestMeta.promptKind,
        error,
      });
      throw error;
    }
  }, Number(subscription.priority_weight || 0));
}

async function generateReplyViaGateway({ requestId, userId, conversationId = null, character, messages, userMessage, systemHint = '', promptKind = 'chat', modelMode = 'standard', signal = null, user = null }) {
  const result = await executeLlmQueued(
    { requestId, userId, conversationId, character, messages, userMessage, systemHint, promptKind, modelMode, user },
    ({ provider, promptMessages, subscription }) => callProvider(provider, promptMessages, subscription.max_output_tokens || 0, modelMode, { signal }),
  );
  return result.content;
}

async function streamReplyViaGateway({ requestId, userId, conversationId = null, character, messages, userMessage, systemHint = '', promptKind = 'chat', modelMode = 'standard', onDelta = null, signal = null, user = null }) {
  return executeLlmQueued(
    { requestId, userId, conversationId, character, messages, userMessage, systemHint, promptKind, modelMode, user },
    ({ provider, promptMessages, subscription }) => callProviderStream(provider, promptMessages, subscription.max_output_tokens || 0, modelMode, { onDelta, signal }),
  );
}

async function streamOptimizeUserInputViaGateway({ requestId, userId, conversationId = null, character, messages, userInput, modelMode = 'standard', onDelta = null, signal = null, user = null }) {
  return executeLlmQueued(
    {
      requestId,
      userId,
      conversationId,
      character,
      messages,
      userMessage: `原始输入：\n${String(userInput || '').trim()}`,
      systemHint: '你要帮用户优化输入内容。输出只给优化后的用户输入，不要解释，不要加引号。',
      promptKind: 'optimize',
      modelMode,
      user,
    },
    ({ provider, promptMessages, subscription }) => callProviderStream(provider, promptMessages, subscription.max_output_tokens || 0, modelMode, { onDelta, signal }),
  );
}

async function optimizeUserInputViaGateway({ requestId, userId, conversationId = null, character, messages, userInput, modelMode = 'standard', signal = null, user = null }) {
  const result = await executeLlmQueued(
    {
      requestId,
      userId,
      conversationId,
      character,
      messages,
      userMessage: `原始输入：\n${String(userInput || '').trim()}`,
      systemHint: '你要帮用户优化输入内容。输出只给优化后的用户输入，不要解释，不要加引号。',
      promptKind: 'optimize',
      modelMode,
      user,
    },
    ({ provider, promptMessages, subscription }) => callProvider(provider, promptMessages, subscription.max_output_tokens || 0, modelMode, { signal }),
  );
  return result.content;
}


async function getChatModelSelector() {
  const provider = await getActiveProvider();
  if (!provider) {
    return {
      provider: null,
      options: [],
      maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
      trimContextTokens: DEFAULT_TRIM_CONTEXT_TOKENS,
    };
  }

  provider.availableModels = buildModelOptions((() => {
    try {
      return JSON.parse(provider.available_models_json || '[]');
    } catch (error) {
      return [];
    }
  })());

  return {
    provider,
    options: buildModelModeOptions(provider),
    maxContextTokens: Number(provider.max_context_tokens || DEFAULT_MAX_CONTEXT_TOKENS),
    trimContextTokens: Number(provider.trim_context_tokens || DEFAULT_TRIM_CONTEXT_TOKENS),
  };
}

module.exports = {
  MAX_GLOBAL_CONCURRENCY,
  generateReplyViaGateway,
  streamReplyViaGateway,
  streamOptimizeUserInputViaGateway,
  optimizeUserInputViaGateway,
  getChatModelSelector,
};
