/**
 * @file src/routes/web/auth-routes.js
 * @description 认证与个人中心路由聚合器。具体实现拆分在 `src/routes/web/auth/`。
 */

const { registerAuthVerificationRoutes } = require('./auth/verification-routes');
const { registerAuthRegisterRoutes } = require('./auth/register-routes');
const { registerAuthSessionRoutes } = require('./auth/session-routes');
const { registerAuthDashboardRoutes } = require('./auth/dashboard-routes');
const { registerAuthProfileRoutes } = require('./auth/profile-routes');
const { registerAuthSiteMessageRoutes } = require('./auth/site-message-routes');

function registerAuthRoutes(app, ctx) {
  registerAuthVerificationRoutes(app, ctx);
  registerAuthRegisterRoutes(app, ctx);
  registerAuthSessionRoutes(app, ctx);
  registerAuthDashboardRoutes(app, ctx);
  registerAuthProfileRoutes(app, ctx);
  registerAuthSiteMessageRoutes(app, ctx);
}

module.exports = { registerAuthRoutes };
