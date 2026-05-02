/**
 * @file src/routes/web/admin/site-message-routes.js
 * @description 管理后台站内信投递与历史查询路由。
 */

function registerAdminSiteMessageRoutes(app, ctx) {
  const {
    requireAdmin,
    listPlans,
    listUsersWithPlans,
    createSiteMessage,
    listSiteMessagesForAdmin,
    renderPage,
  } = ctx;

  app.get('/admin/site-messages', requireAdmin, async (req, res, next) => {
    try {
      const [messages, plans, users] = await Promise.all([
        listSiteMessagesForAdmin(50),
        listPlans(),
        listUsersWithPlans(),
      ]);
      renderPage(res, 'admin-site-messages', {
        title: '站内信管理',
        messages,
        plans,
        users,
        formMessage: req.query.sent
          ? { type: 'success', text: `站内信已发送给 ${Number(req.query.sent || 0)} 个用户。` }
          : null,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/site-messages/send', requireAdmin, async (req, res, next) => {
    try {
      const result = await createSiteMessage(req.body, req.session?.user?.id || null);
      res.redirect(`/admin/site-messages?sent=${encodeURIComponent(result.recipientCount)}`);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerAdminSiteMessageRoutes };
