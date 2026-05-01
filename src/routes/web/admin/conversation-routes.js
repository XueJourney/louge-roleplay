/**
 * @file src/routes/web/admin/conversation-routes.js
 * @description 管理后台全局对话审计、软删除恢复与永久删除路由。
 */

const { buildPageUrl } = require('./admin-route-utils');

function registerAdminConversationRoutes(app, ctx) {
  const {
    requireAdmin,
    getAdminConversationDetail,
    listAdminConversations,
    permanentlyDeleteConversation,
    permanentlyDeleteMessage,
    restoreConversation,
    restoreMessage,
    invalidateConversationCache,
    renderPage,
    renderValidationMessage,
    parseIntegerField,
    parseIdParam,
  } = ctx;

  app.get('/admin/conversations', requireAdmin, async (req, res, next) => {
    try {
      const conversationResult = await listAdminConversations({
        userId: req.query.userId,
        characterId: req.query.characterId,
        date: req.query.date,
        status: req.query.status,
        page: parseIntegerField(req.query.page, { fieldLabel: '页码', defaultValue: 1, min: 1 }),
        pageSize: parseIntegerField(req.query.pageSize, { fieldLabel: '分页大小', defaultValue: 25, min: 1 }),
      });

      renderPage(res, 'admin-conversations', {
        title: '全局对话记录',
        conversationResult,
        buildPageUrl: (targetPage) => buildPageUrl('/admin/conversations', conversationResult.filters, targetPage, conversationResult.pageSize, { skipZero: true }),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/conversations/:conversationId', requireAdmin, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const detail = await getAdminConversationDetail(conversationId);
      if (!detail) {
        return renderValidationMessage(res, '这条对话记录不存在。', '全局对话记录');
      }

      renderPage(res, 'admin-conversation-detail', {
        title: `对话 #${conversationId}`,
        detail,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/conversations/:conversationId/restore', requireAdmin, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      await restoreConversation(conversationId);
      return res.redirect(`/admin/conversations/${conversationId}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/conversations/:conversationId/permanent-delete', requireAdmin, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      await permanentlyDeleteConversation(conversationId);
      return res.redirect('/admin/conversations?status=deleted');
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/conversations/:conversationId/messages/:messageId/restore', requireAdmin, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      await restoreMessage(conversationId, messageId);
      invalidateConversationCache(conversationId).catch(() => {});
      return res.redirect(`/admin/conversations/${conversationId}#message-${messageId}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/conversations/:conversationId/messages/:messageId/permanent-delete', requireAdmin, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      try {
        await permanentlyDeleteMessage(conversationId, messageId);
      } catch (error) {
        if (error.code === 'MESSAGE_HAS_CHILDREN') {
          return renderValidationMessage(res, `这条消息还有 ${error.childMessageCount} 条子消息，不能单独永久删除。`, '全局对话记录');
        }
        throw error;
      }
      invalidateConversationCache(conversationId).catch(() => {});
      return res.redirect(`/admin/conversations/${conversationId}`);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerAdminConversationRoutes };
