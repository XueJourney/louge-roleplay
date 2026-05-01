/**
 * @file src/routes/web/admin/notification-routes.js
 * @description 管理后台通知中心与前台客服通知查询接口。
 */

function registerAdminNotificationRoutes(app, ctx) {
  const {
    requireAdmin,
    DEFAULT_SUPPORT_QR_URL,
    listNotificationsForAdmin,
    listActiveNotificationsForUser,
    createNotification,
    updateNotification,
    deleteNotification,
    renderPage,
    parseIdParam,
  } = ctx;

  app.get('/admin/notifications', requireAdmin, async (req, res, next) => {
    try {
      const allNotifications = await listNotificationsForAdmin();
      const supportNotification = allNotifications.find((item) => item.notification_type === 'support') || null;
      const notifications = allNotifications.filter((item) => item.notification_type !== 'support');
      renderPage(res, 'admin-notifications', {
        title: '通知中心',
        notifications,
        supportNotification,
        defaultSupportQrUrl: DEFAULT_SUPPORT_QR_URL,
        formMessage: req.query.saved ? { type: 'success', text: '配置已经保存。' } : null,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/notifications/new', requireAdmin, async (req, res, next) => {
    try {
      await createNotification(req.body);
      res.redirect('/admin/notifications?saved=1');
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/notifications/:notificationId', requireAdmin, async (req, res, next) => {
    try {
      const notificationId = parseIdParam(req.params.notificationId, '通知 ID');
      await updateNotification(notificationId, req.body);
      res.redirect('/admin/notifications?saved=1');
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/notifications/:notificationId/delete', requireAdmin, async (req, res, next) => {
    try {
      const notificationId = parseIdParam(req.params.notificationId, '通知 ID');
      await deleteNotification(notificationId);
      res.redirect('/admin/notifications?saved=1');
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/support-notification', async (req, res, next) => {
    try {
      const notifications = await listActiveNotificationsForUser(res.locals.currentUser || null, { supportOnly: true });
      res.json({ notification: notifications[0] || null });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerAdminNotificationRoutes };
