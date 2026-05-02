/**
 * @file src/services/admin-service.js
 * @description 管理后台所需的用户、套餐、LLM 配置与使用统计。
 */

const { query, withTransaction } = require('../lib/db');
const { getCurrentUsageForUser } = require('./plan/subscriptions');

function formatDateTimeForDb(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildStaleJobCutoff(minutes = 10) {
  return formatDateTimeForDb(new Date(Date.now() - minutes * 60 * 1000));
}

function calculateQuotaPercent(used, total) {
  const safeUsed = Math.max(0, Number(used || 0));
  const safeTotal = Math.max(0, Number(total || 0));
  if (!safeTotal) return 0;
  return Math.min(100, Math.round((safeUsed / safeTotal) * 100));
}

function getQuotaState(percent) {
  const value = Number(percent || 0);
  if (value >= 90) return 'danger';
  if (value >= 70) return 'warn';
  return 'healthy';
}

async function attachUserQuotaSnapshots(users = []) {
  return Promise.all(users.map(async (user) => {
    if (!user.plan_id) {
      return {
        ...user,
        plan_details: null,
        quota_snapshot: null,
      };
    }

    const usage = await getCurrentUsageForUser(user.id, user);
    const requestQuota = Number(user.request_quota || 0);
    const tokenQuota = Number(user.token_quota || 0);
    const usedRequests = Number(usage.usedRequests || 0);
    const usedTokens = Number(usage.usedTokens || 0);
    const remainingRequests = Math.max(0, requestQuota - usedRequests);
    const remainingTokens = Math.max(0, tokenQuota - usedTokens);
    const requestUsagePercent = calculateQuotaPercent(usedRequests, requestQuota);
    const tokenUsagePercent = calculateQuotaPercent(usedTokens, tokenQuota);

    return {
      ...user,
      used_requests: usedRequests,
      used_tokens: usedTokens,
      remaining_requests: remainingRequests,
      remaining_tokens: remainingTokens,
      request_usage_percent: requestUsagePercent,
      token_usage_percent: tokenUsagePercent,
      quota_state: getQuotaState(Math.max(requestUsagePercent, tokenUsagePercent)),
      plan_details: {
        id: user.plan_id,
        code: user.plan_code,
        name: user.plan_name,
        description: user.plan_description,
        billingMode: user.billing_mode,
        quotaPeriod: user.quota_period,
        requestQuota,
        tokenQuota,
        priorityWeight: Number(user.priority_weight || 0),
        concurrencyLimit: Number(user.concurrency_limit || 0),
        maxOutputTokens: Number(user.max_output_tokens || 0),
        status: user.plan_status,
        modelCount: Number(user.model_count || 0),
        subscriptionStartedAt: user.subscription_started_at,
      },
      quota_snapshot: {
        usage,
        remainingRequests,
        remainingTokens,
        requestUsagePercent,
        tokenUsagePercent,
      },
    };
  }));
}

async function listUsersWithPlans() {
  const rows = await query(
    `SELECT u.id, u.public_id, u.username, u.nickname, u.email, u.phone, u.role, u.status,
            u.country_type, u.created_at,
            us.id AS subscription_id, us.started_at AS subscription_started_at,
            p.id AS plan_id, p.name AS plan_name, p.code AS plan_code, p.description AS plan_description,
            p.billing_mode, p.quota_period, p.request_quota, p.token_quota,
            p.priority_weight, p.concurrency_limit, p.max_output_tokens, p.plan_models_json,
            p.status AS plan_status
     FROM users u
     LEFT JOIN user_subscriptions us
       ON us.user_id = u.id AND us.status = 'active'
     LEFT JOIN plans p
       ON p.id = us.plan_id
     ORDER BY u.id ASC`,
  );

  const users = rows.map((row) => ({
    ...row,
    model_count: (() => {
      try {
        const models = JSON.parse(row.plan_models_json || '[]');
        return Array.isArray(models) ? models.length : 0;
      } catch (_error) {
        return 0;
      }
    })(),
  }));

  return attachUserQuotaSnapshots(users);
}

async function getUserBusinessDataCounts(userId) {
  const [characterRows, conversationRows, messageRows, subscriptionRows, usageRows] = await Promise.all([
    query('SELECT COUNT(*) AS count FROM characters WHERE user_id = ?', [userId]),
    query('SELECT COUNT(*) AS count FROM conversations WHERE user_id = ?', [userId]),
    query(
      `SELECT COUNT(*) AS count
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ?`,
      [userId],
    ),
    query('SELECT COUNT(*) AS count FROM user_subscriptions WHERE user_id = ?', [userId]),
    query('SELECT COUNT(*) AS count FROM llm_usage_logs WHERE user_id = ?', [userId]),
  ]);

  return {
    characters: Number(characterRows[0]?.count || 0),
    conversations: Number(conversationRows[0]?.count || 0),
    messages: Number(messageRows[0]?.count || 0),
    subscriptions: Number(subscriptionRows[0]?.count || 0),
    usageLogs: Number(usageRows[0]?.count || 0),
  };
}

function hasUserBusinessData(counts) {
  return Object.values(counts || {}).some((value) => Number(value || 0) > 0);
}

async function safelyDeleteUserById(userId) {
  return withTransaction(async (conn) => {
    const [characterRows] = await conn.execute('SELECT COUNT(*) AS count FROM characters WHERE user_id = ?', [userId]);
    const [conversationRows] = await conn.execute('SELECT COUNT(*) AS count FROM conversations WHERE user_id = ?', [userId]);
    const [messageRows] = await conn.execute(
      `SELECT COUNT(*) AS count
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ?`,
      [userId],
    );
    const [subscriptionRows] = await conn.execute('SELECT COUNT(*) AS count FROM user_subscriptions WHERE user_id = ?', [userId]);
    const [usageRows] = await conn.execute('SELECT COUNT(*) AS count FROM llm_usage_logs WHERE user_id = ?', [userId]);
    const counts = {
      characters: Number(characterRows[0]?.count || 0),
      conversations: Number(conversationRows[0]?.count || 0),
      messages: Number(messageRows[0]?.count || 0),
      subscriptions: Number(subscriptionRows[0]?.count || 0),
      usageLogs: Number(usageRows[0]?.count || 0),
    };

    if (hasUserBusinessData(counts)) {
      await conn.execute('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?', ['blocked', userId]);
      return { deleted: false, blocked: true, counts };
    }

    const [result] = await conn.execute('DELETE FROM users WHERE id = ?', [userId]);
    return { deleted: Number(result?.affectedRows || 0) > 0, blocked: false, counts };
  });
}

async function listProviders() {
  return query(
    `SELECT id, name, provider_type, base_url, api_key_masked, model, is_active, status,
            max_concurrency, timeout_ms, created_at, updated_at
     FROM llm_providers
     ORDER BY is_active DESC, id ASC`,
  );
}

async function getAdminOverview({ runtimeQueueState = null } = {}) {
  const staleJobCutoff = buildStaleJobCutoff(10);
  const [userRows, planBoundRows, providerRows, planRows, presetModelRows, promptBlockRows, activePlanRows, staleQueueRows, usageRows] = await Promise.all([
    query(`SELECT
             COUNT(*) AS total_users,
             SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_users,
             SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admin_users,
             SUM(CASE WHEN status <> 'active' THEN 1 ELSE 0 END) AS inactive_users
           FROM users`),
    query(`SELECT COUNT(DISTINCT u.id) AS plan_bound_users
           FROM users u
           JOIN user_subscriptions us ON us.user_id = u.id AND us.status = 'active'`),
    query(`SELECT
             COUNT(*) AS total_providers,
             SUM(CASE WHEN is_active = 1 AND status = 'active' THEN 1 ELSE 0 END) AS active_providers
           FROM llm_providers`),
    query(`SELECT
             COUNT(*) AS total_plans,
             SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_plans,
             SUM(CASE WHEN is_default = 1 THEN 1 ELSE 0 END) AS default_plans
           FROM plans`),
    query(`SELECT
             COUNT(*) AS total_preset_models,
             SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_preset_models
           FROM preset_models`),
    query(`SELECT
             COUNT(*) AS total_prompt_blocks,
             SUM(CASE WHEN is_enabled = 1 THEN 1 ELSE 0 END) AS enabled_prompt_blocks
           FROM system_prompt_blocks`),
    query("SELECT COUNT(*) AS active_subscriptions FROM user_subscriptions WHERE status = 'active'"),
    query("SELECT COUNT(*) AS stale_running_jobs FROM llm_jobs WHERE status = 'running' AND updated_at < ?", [staleJobCutoff]),
    query("SELECT COUNT(*) AS total_requests, COALESCE(SUM(total_cost), 0) AS total_cost FROM llm_usage_logs"),
  ]);

  const liveRuntimeJobs = Number(runtimeQueueState?.activeCount || 0) + Number(runtimeQueueState?.pendingQueueLength || 0);

  return {
    totalUsers: Number(userRows[0]?.total_users || 0),
    activeUsers: Number(userRows[0]?.active_users || 0),
    adminUsers: Number(userRows[0]?.admin_users || 0),
    inactiveUsers: Number(userRows[0]?.inactive_users || 0),
    planBoundUsers: Number(planBoundRows[0]?.plan_bound_users || 0),
    totalProviders: Number(providerRows[0]?.total_providers || 0),
    activeProviders: Number(providerRows[0]?.active_providers || 0),
    totalPlans: Number(planRows[0]?.total_plans || 0),
    activePlans: Number(planRows[0]?.active_plans || 0),
    defaultPlans: Number(planRows[0]?.default_plans || 0),
    totalPresetModels: Number(presetModelRows[0]?.total_preset_models || 0),
    activePresetModels: Number(presetModelRows[0]?.active_preset_models || 0),
    totalPromptBlocks: Number(promptBlockRows[0]?.total_prompt_blocks || 0),
    enabledPromptBlocks: Number(promptBlockRows[0]?.enabled_prompt_blocks || 0),
    activeSubscriptions: Number(activePlanRows[0]?.active_subscriptions || 0),
    queuedJobs: liveRuntimeJobs,
    runtimeQueueActive: Number(runtimeQueueState?.activeCount || 0),
    runtimeQueuePending: Number(runtimeQueueState?.pendingQueueLength || 0),
    runtimeQueueMaxConcurrency: Number(runtimeQueueState?.maxConcurrency || 0),
    staleRunningJobs: Number(staleQueueRows[0]?.stale_running_jobs || 0),
    totalRequests: Number(usageRows[0]?.total_requests || 0),
    totalCost: Number(usageRows[0]?.total_cost || 0),
  };
}

module.exports = {
  listUsersWithPlans,
  getUserBusinessDataCounts,
  safelyDeleteUserById,
  listProviders,
  getAdminOverview,
};
