/**
 * @file src/services/llm-usage-service.js
 * @description LLM 调用记录、作业队列记录与配额消耗。
 */

const { query } = require('../lib/db');

async function createLlmJob({ requestId, userId, conversationId = null, providerId = null, priority = 0, status = 'queued', promptKind = 'chat' }) {
  const result = await query(
    `INSERT INTO llm_jobs (
      request_id, user_id, conversation_id, provider_id, priority, status, prompt_kind, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [requestId, userId, conversationId, providerId, priority, status, promptKind],
  );
  return result.insertId;
}

async function updateLlmJob(jobId, payload) {
  await query(
    `UPDATE llm_jobs
     SET provider_id = ?,
         status = ?,
         started_at = ?,
         finished_at = ?,
         error_message = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      payload.providerId || null,
      payload.status || 'queued',
      payload.startedAt || null,
      payload.finishedAt || null,
      payload.errorMessage || null,
      jobId,
    ],
  );
}

async function createUsageLog({
  requestId,
  userId,
  conversationId = null,
  providerId = null,
  planId = null,
  promptKind = 'chat',
  status = 'success',
  modelKey = null,
  modelId = null,
  requestMultiplier = 1,
  tokenMultiplier = 1,
  billableRequestUnits = 1,
  billableTokens = null,
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = 0,
  totalCost = 0,
  latencyMs = 0,
  errorMessage = null,
}) {
  await query(
    `INSERT INTO llm_usage_logs (
      request_id, user_id, conversation_id, provider_id, plan_id, prompt_kind, status,
      model_key, model_id, request_multiplier, token_multiplier, billable_request_units, billable_tokens,
      input_tokens, output_tokens, total_tokens, total_cost, latency_ms, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      requestId,
      userId,
      conversationId,
      providerId,
      planId,
      promptKind,
      status,
      modelKey,
      modelId,
      requestMultiplier,
      tokenMultiplier,
      billableRequestUnits,
      billableTokens === null || billableTokens === undefined ? totalTokens : billableTokens,
      inputTokens,
      outputTokens,
      totalTokens,
      totalCost,
      latencyMs,
      errorMessage,
    ],
  );
}

async function recoverInterruptedLlmJobs(reason = 'Job interrupted by application restart before completion') {
  const result = await query(
    `UPDATE llm_jobs
     SET status = 'failed',
         finished_at = COALESCE(finished_at, NOW()),
         error_message = COALESCE(error_message, ?),
         updated_at = NOW()
     WHERE status IN ('queued', 'running')`,
    [String(reason || '').slice(0, 255)],
  );
  return Number(result?.affectedRows || 0);
}

module.exports = {
  createLlmJob,
  updateLlmJob,
  createUsageLog,
  recoverInterruptedLlmJobs,
};
