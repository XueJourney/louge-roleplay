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
    revokeSiteMessage,
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
          : (req.query.revoked
            ? { type: 'success', text: `站内信 #${Number(req.query.revoked || 0)} 已撤回。` }
            : (req.query.error ? { type: 'error', text: String(req.query.error).slice(0, 200) } : null)),
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
      if (error?.statusCode === 400 || String(error?.code || '').startsWith('SITE_MESSAGE_')) {
        res.redirect(`/admin/site-messages?error=${encodeURIComponent(error.message || '站内信发送失败。')}`);
        return;
      }
      next(error);
    }
  });

  app.post('/admin/site-messages/:messageId/revoke', requireAdmin, async (req, res, next) => {
    try {
      const messageId = Number(req.params.messageId);
      if (!Number.isFinite(messageId) || messageId <= 0) {
        res.redirect('/admin/site-messages?error=' + encodeURIComponent('站内信 ID 无效。'));
        return;
      }
      const revoked = await revokeSiteMessage(messageId, req.session?.user?.id || null);
      const query = revoked
        ? `revoked=${encodeURIComponent(messageId)}`
        : `error=${encodeURIComponent('该站内信已撤回或不存在。')}`;
      res.redirect(`/admin/site-messages?${query}`);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerAdminSiteMessageRoutes };
