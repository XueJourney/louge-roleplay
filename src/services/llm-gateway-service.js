/**
 * @file src/services/llm-gateway-service.js
 * @description 统一 LLM 调用入口：套餐、优先级、并发控制、provider 配置、用量记录。
 */

const logger = require('../lib/logger');
const { getActiveSubscriptionForUser, assertUserQuotaAvailable, getSubscriptionModelConfig, buildPlanModelOptions } = require('./plan-service');
const { getActiveProvider, getProviderById } = require('./llm-provider-service');
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
    replyLengthPreference: String(user?.reply_length_preference || user?.replyLengthPreference || 'medium').trim() || 'medium',
    now,
    timeZone: 'Asia/Hong_Kong',
    time: formatRuntimeTime(now, { timeZone: 'Asia/Hong_Kong' }),
  };
}

async function resolveProviderForPlanModel(modelConfig, activeProvider = null) {
  if (modelConfig?.providerId) {
    const provider = await getProviderById(modelConfig.providerId);
    if (provider) {
      return provider;
    }
  }
  return activeProvider;
}

function attachSelectedModel(provider, modelConfig) {
  if (!provider || !modelConfig) {
    return provider;
  }
  return {
    ...provider,
    selected_model_key: modelConfig.modelKey,
    selected_model_label: modelConfig.label,
    selected_model_id: modelConfig.modelId,
    request_multiplier: modelConfig.requestMultiplier,
    token_multiplier: modelConfig.tokenMultiplier,
  };
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

  const rawModelMode = String(modelMode || '').trim();
  const modelOptions = buildPlanModelOptions(subscription);
  const modelConfig = getSubscriptionModelConfig(subscription, rawModelMode);
  if (rawModelMode && rawModelMode !== modelConfig.modelKey) {
    logger.warn('Requested LLM model mode is unavailable for plan; using fallback model', {
      requestId,
      userId,
      conversationId,
      requestedModelMode: rawModelMode,
      fallbackModelMode: modelConfig.modelKey,
    });
  }

  const provider = await resolveProviderForPlanModel(modelConfig, await getActiveProvider());
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
      modelMode: modelConfig?.modelKey || modelMode,
      selectedModel: modelConfig,
      modelOptions,
    };
  }

  const providerForRequest = attachSelectedModel(provider, modelConfig);

  const runtimeContext = buildRuntimeContext({ user });
  const promptBuild = await buildPromptMessages({ provider: providerForRequest, character, messages, userMessage, systemHint, runtimeContext });
  const promptMessages = promptBuild.promptMessages;
  const estimatedTokens = estimatePromptTokens(promptMessages) + Number(subscription.max_output_tokens || 0);
  const quotaCheck = await assertUserQuotaAvailable(userId, estimatedTokens, modelConfig);

  const jobId = await createLlmJob({
    requestId,
    userId,
    conversationId,
    providerId: providerForRequest.id,
    priority: Number(subscription.priority_weight || 0),
    status: 'queued',
    promptKind,
  });

  return {
    subscription,
    provider: providerForRequest,
    modelConfig,
    modelOptions,
    quotaCheck,
    promptBuild,
    promptMessages,
    jobId,
  };
}

async function finalizeLlmJobSuccess({ jobId, startedAt, provider, subscription, requestId, userId, conversationId, promptKind, result, modelMode, modelConfig, modelOptions, promptBuild }) {
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
    modelKey: modelConfig?.modelKey || modelMode,
    modelId: provider.selected_model_id || result.modelId || '',
    requestMultiplier: modelConfig?.requestMultiplier || 1,
    tokenMultiplier: modelConfig?.tokenMultiplier || 1,
    billableRequestUnits: Math.ceil(Number(modelConfig?.requestMultiplier || 1)),
    billableTokens: Math.ceil(Number(result.totalTokens || 0) * Number(modelConfig?.tokenMultiplier || 1)),
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
    modelMode: modelConfig?.modelKey || modelMode,
    selectedModel: modelConfig || null,
    modelOptions: modelOptions || buildPlanModelOptions(subscription),
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
  const { subscription, provider, modelConfig, modelOptions, promptBuild, promptMessages, jobId } = prepared;
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
        modelConfig,
        modelOptions,
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

function resolveCallModelMode(provider, modelMode) {
  return provider?.selected_model_key || modelMode;
}

async function generateReplyViaGateway({ requestId, userId, conversationId = null, character, messages, userMessage, systemHint = '', promptKind = 'chat', modelMode = 'standard', signal = null, user = null }) {
  const result = await executeLlmQueued(
    { requestId, userId, conversationId, character, messages, userMessage, systemHint, promptKind, modelMode, user },
    ({ provider, promptMessages, subscription }) => callProvider(provider, promptMessages, subscription.max_output_tokens || 0, resolveCallModelMode(provider, modelMode), { signal }),
  );
  return result.content;
}

async function streamReplyViaGateway({ requestId, userId, conversationId = null, character, messages, userMessage, systemHint = '', promptKind = 'chat', modelMode = 'standard', onDelta = null, signal = null, user = null }) {
  return executeLlmQueued(
    { requestId, userId, conversationId, character, messages, userMessage, systemHint, promptKind, modelMode, user },
    ({ provider, promptMessages, subscription }) => callProviderStream(provider, promptMessages, subscription.max_output_tokens || 0, resolveCallModelMode(provider, modelMode), { onDelta, signal }),
  );
}

function buildOptimizeSystemPrompt(userInput) {
  return [
    '你是“用户输入润色器”，不是聊天角色，也不是回复生成器。',
    '任务：只把用户即将发送给角色的话润色得更清楚、更自然。',
    '硬性规则：',
    '1. 只能输出润色后的用户输入本身；不要解释、不要加标题、不要加引号。',
    '2. 必须保持第一人称/第二人称关系、原意、情绪、语气和信息量。',
    '3. 不要代替角色回复，不要写 AI/助手/角色会说的话。',
    '4. 不要续写剧情，不要增加新的动作、事实、承诺或设定。',
    '5. 如果原文是在问问题，仍然输出问题；如果原文是在表达感受，仍然输出用户的表达。',
    `原始用户输入：\n${String(userInput || '').trim()}`,
  ].join('\n');
}

async function streamOptimizeUserInputViaGateway({ requestId, userId, conversationId = null, character, messages, userInput, modelMode = 'standard', onDelta = null, signal = null, user = null }) {
  const optimizePrompt = buildOptimizeSystemPrompt(userInput);
  return executeLlmQueued(
    {
      requestId,
      userId,
      conversationId,
      character: { name: '用户输入润色器', summary: '', personality: '', first_message: '', prompt_profile_json: null },
      messages: [],
      userMessage: optimizePrompt,
      systemHint: '严格按用户输入润色器规则执行。输出只能是润色后的用户输入，绝不能输出角色回复或 AI 回复。',
      promptKind: 'optimize',
      modelMode,
      user,
    },
    ({ provider, promptMessages, subscription }) => callProviderStream(provider, promptMessages, Math.min(Number(subscription.max_output_tokens || 0) || 800, 800), resolveCallModelMode(provider, modelMode), { onDelta, signal }),
  );
}

async function optimizeUserInputViaGateway({ requestId, userId, conversationId = null, character, messages, userInput, modelMode = 'standard', signal = null, user = null }) {
  const optimizePrompt = buildOptimizeSystemPrompt(userInput);
  const result = await executeLlmQueued(
    {
      requestId,
      userId,
      conversationId,
      character: { name: '用户输入润色器', summary: '', personality: '', first_message: '', prompt_profile_json: null },
      messages: [],
      userMessage: optimizePrompt,
      systemHint: '严格按用户输入润色器规则执行。输出只能是润色后的用户输入，绝不能输出角色回复或 AI 回复。',
      promptKind: 'optimize',
      modelMode,
      user,
    },
    ({ provider, promptMessages, subscription }) => callProvider(provider, promptMessages, Math.min(Number(subscription.max_output_tokens || 0) || 800, 800), resolveCallModelMode(provider, modelMode), { signal }),
  );
  return result.content;
}


async function getChatModelSelector(userId = null) {
  const subscription = userId ? await getActiveSubscriptionForUser(userId) : null;
  const activeProvider = await getActiveProvider();
  if (!activeProvider && !subscription) {
    return {
      provider: null,
      options: [],
      maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
      trimContextTokens: DEFAULT_TRIM_CONTEXT_TOKENS,
    };
  }

  const options = subscription ? buildPlanModelOptions(subscription) : [];
  return {
    provider: activeProvider,
    plan: subscription,
    options,
    maxContextTokens: Number(activeProvider?.max_context_tokens || DEFAULT_MAX_CONTEXT_TOKENS),
    trimContextTokens: Number(activeProvider?.trim_context_tokens || DEFAULT_TRIM_CONTEXT_TOKENS),
  };
}

function getLlmRuntimeQueueState() {
  return llmQueue.getState();
}

module.exports = {
  MAX_GLOBAL_CONCURRENCY,
  getLlmRuntimeQueueState,
  generateReplyViaGateway,
  streamReplyViaGateway,
  streamOptimizeUserInputViaGateway,
  optimizeUserInputViaGateway,
  getChatModelSelector,
};
