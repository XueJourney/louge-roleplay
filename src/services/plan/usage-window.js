/**
 * @file src/services/plan/usage-window.js
 * @description 根据数据库类型和套餐周期生成用量统计时间窗口 SQL。
 */

function buildUsageSinceClause(subscription, dbType) {
  const period = String(subscription.quota_period || 'lifetime');
  const isSQLite = dbType === 'sqlite';

  if (period === 'daily') {
    return isSQLite
      ? "AND created_at >= datetime('now', '-1 day')"
      : 'AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)';
  }

  if (period === 'monthly') {
    return isSQLite
      ? "AND created_at >= datetime('now', '-1 month')"
      : 'AND created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
  }

  return '';
}

module.exports = { buildUsageSinceClause };
