/**
 * @file src/routes/web/auth/dashboard-routes.js
 * @description 用户控制台路由，汇总角色、会话、套餐和额度快照。
 */

function registerAuthDashboardRoutes(app, ctx) {
  const {
    requireAuth,
    findUserById,
    listUserCharacters,
    getActiveSubscriptionForUser,
    getUserQuotaSnapshot,
    listUserConversations,
    renderPage,
  } = ctx;

  app.get('/dashboard', requireAuth, async (req, res, next) => {
    try {
      const user = await findUserById(req.session.user.id);
      if (!user) {
        // 用户记录已不存在（被删除），清除会话并跳转登录页
        return req.session.destroy(() => res.redirect('/login'));
      }
      const characters = await listUserCharacters(req.session.user.id);
      const conversations = await listUserConversations(req.session.user.id);
      const subscription = await getActiveSubscriptionForUser(req.session.user.id);
      const quota = await getUserQuotaSnapshot(req.session.user.id);
      renderPage(res, 'dashboard', { title: '控制台', user, characters, conversations, subscription, quota });
    } catch (error) {
      next(error);
    }
  });

}

module.exports = { registerAuthDashboardRoutes };
