/**
 * @file src/services/admin-service.js
 * @description 管理后台所需的用户、套餐、LLM 配置与使用统计。
 */

const { query } = require('../lib/db');

async function listUsersWithPlans() {
  return query(
    `SELECT u.id, u.public_id, u.username, u.nickname, u.email, u.phone, u.role, u.status,
            u.country_type, u.created_at,
            p.name AS plan_name, p.code AS plan_code, p.billing_mode,
            p.priority_weight, p.concurrency_limit
     FROM users u
     LEFT JOIN user_subscriptions us
       ON us.user_id = u.id AND us.status = 'active'
     LEFT JOIN plans p
       ON p.id = us.plan_id
     ORDER BY u.id ASC`,
  );
}

async function listProviders() {
  return query(
    `SELECT id, name, provider_type, base_url, api_key_masked, model, is_active, status,
            max_concurrency, timeout_ms, created_at, updated_at
     FROM llm_providers
     ORDER BY is_active DESC, id ASC`,
  );
}

async function getAdminOverview() {
  const [userRows] = await Promise.all([
    query('SELECT COUNT(*) AS total_users FROM users'),
  ]);
  const [providerRows, activePlanRows, queueRows, usageRows] = await Promise.all([
    query('SELECT COUNT(*) AS total_providers, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_providers FROM llm_providers'),
    query("SELECT COUNT(*) AS active_subscriptions FROM user_subscriptions WHERE status = 'active'"),
    query("SELECT COUNT(*) AS queued_jobs FROM llm_jobs WHERE status IN ('queued','running')"),
    query("SELECT COUNT(*) AS total_requests, COALESCE(SUM(total_cost), 0) AS total_cost FROM llm_usage_logs"),
  ]);

  return {
    totalUsers: Number(userRows[0]?.total_users || 0),
    totalProviders: Number(providerRows[0]?.total_providers || 0),
    activeProviders: Number(providerRows[0]?.active_providers || 0),
    activeSubscriptions: Number(activePlanRows[0]?.active_subscriptions || 0),
    queuedJobs: Number(queueRows[0]?.queued_jobs || 0),
    totalRequests: Number(usageRows[0]?.total_requests || 0),
    totalCost: Number(usageRows[0]?.total_cost || 0),
  };
}

module.exports = {
  listUsersWithPlans,
  listProviders,
  getAdminOverview,
};
