/**
 * @file src/routes/web/auth/site-message-routes.js
 * @description 用户站内信收件箱与实时轮询接口。
 */

function registerAuthSiteMessageRoutes(app, ctx) {
  const {
    requireAuth,
    listInboxMessagesForUser,
    getSiteMessageRealtimeSnapshot,
    markSiteMessageRead,
    markAllSiteMessagesRead,
    renderPage,
    parseIdParam,
  } = ctx;

  app.get('/messages', requireAuth, async (req, res, next) => {
    try {
      const messages = await listInboxMessagesForUser(req.session.user.id, { limit: 100 });
      renderPage(res, 'site-messages', { title: '站内信', messages });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/site-messages/status', requireAuth, async (req, res, next) => {
    try {
      const snapshot = await getSiteMessageRealtimeSnapshot(req.session.user.id);
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/site-messages/:messageId/read', requireAuth, async (req, res, next) => {
    try {
      const messageId = parseIdParam(req.params.messageId, '站内信 ID');
      await markSiteMessageRead(req.session.user.id, messageId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/messages/:messageId/read', requireAuth, async (req, res, next) => {
    try {
      const messageId = parseIdParam(req.params.messageId, '站内信 ID');
      await markSiteMessageRead(req.session.user.id, messageId);
      res.redirect('/messages');
    } catch (error) {
      next(error);
    }
  });

  app.post('/messages/read-all', requireAuth, async (req, res, next) => {
    try {
      await markAllSiteMessagesRead(req.session.user.id);
      res.redirect('/messages');
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerAuthSiteMessageRoutes };
