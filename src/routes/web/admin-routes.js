/**
 * @file src/routes/web/admin-routes.js
 * @description 管理后台路由聚合器。具体页面/表单路由拆分在 `src/routes/web/admin/`，本文件只保持注册顺序。
 */

const { registerAdminDashboardRoutes } = require('./admin/dashboard-routes');
const { registerAdminPlanRoutes } = require('./admin/plan-routes');
const { registerAdminProviderRoutes } = require('./admin/provider-routes');
const { registerAdminNotificationRoutes } = require('./admin/notification-routes');
const { registerAdminPromptRoutes } = require('./admin/prompt-routes');
const { registerAdminLogRoutes } = require('./admin/log-routes');
const { registerAdminConversationRoutes } = require('./admin/conversation-routes');
const { registerAdminUserRoutes } = require('./admin/user-routes');

function registerAdminRoutes(app, ctx) {
  registerAdminDashboardRoutes(app, ctx);
  registerAdminPlanRoutes(app, ctx);
  registerAdminProviderRoutes(app, ctx);
  registerAdminNotificationRoutes(app, ctx);
  registerAdminPromptRoutes(app, ctx);
  registerAdminLogRoutes(app, ctx);
  registerAdminConversationRoutes(app, ctx);
  registerAdminUserRoutes(app, ctx);
}

module.exports = { registerAdminRoutes };
