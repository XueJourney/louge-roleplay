/**
 * @file src/routes/web/admin/dashboard-routes.js
 * @description 管理后台首页路由，展示概览、用户与套餐摘要。
 */

function registerAdminDashboardRoutes(app, ctx) {
  const { requireAdmin, listPlans, listUsersWithPlans, getAdminOverview, renderPage } = ctx;

  app.get('/admin', requireAdmin, async (req, res, next) => {
    try {
      const [overview, users, plans] = await Promise.all([
        getAdminOverview(),
        listUsersWithPlans(),
        listPlans(),
      ]);

      renderPage(res, 'admin', {
        title: '管理员后台',
        overview,
        users,
        plans,
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerAdminDashboardRoutes };
