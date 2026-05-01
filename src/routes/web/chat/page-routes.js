/**
 * @file src/routes/web/chat/page-routes.js
 * @description 聊天路由子分组。
 */

function registerChatPageRoutes(app, ctx) {
  const {
    requireAuth,
    getLatestMessage,
    buildConversationPathView,
    deleteConversationSafely,
    logger,
    query,
    renderPage,
    parseIntegerField,
    parseIdParam,
    renderChatPage,
    loadConversationForUserOrFail,
    renderChatMessageHtml
  } = ctx;

  app.get('/chat/:conversationId', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      logger.debug('Rendering chat page', {
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        requestedLeafId: req.query.leaf || null,
      });

      await renderChatPage(req, res, conversation);
    } catch (error) {
      next(error);
    }
  });

  app.get('/chat/:conversationId/messages/history', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const beforeId = parseIntegerField(req.query.beforeId || req.query.before, { fieldLabel: '起始消息 ID', min: 1, allowEmpty: true });
      const limit = Math.min(parseIntegerField(req.query.limit || '10', { fieldLabel: '加载数量', min: 1 }), 30);
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const latestMessage = conversation.current_message_id ? null : await getLatestMessage(conversationId);
      const fallbackLeafId = conversation.current_message_id || latestMessage?.id || null;
      const leafId = parseIntegerField(req.query.leaf || fallbackLeafId || '', { fieldLabel: '当前消息 ID', min: 1, allowEmpty: true }) || fallbackLeafId;
      const view = await buildConversationPathView(conversationId, leafId);
      const beforeIndex = beforeId
        ? view.pathMessages.findIndex((message) => Number(message.id) === Number(beforeId))
        : view.pathMessages.length;
      const end = beforeIndex >= 0 ? beforeIndex : view.pathMessages.length;
      const start = Math.max(0, end - limit);
      const messages = view.pathMessages.slice(start, end);
      const htmlParts = [];
      for (const message of messages) {
        htmlParts.push(await renderChatMessageHtml(req, conversation, message));
      }

      res.json({
        ok: true,
        html: htmlParts.join('\n'),
        count: messages.length,
        hasMore: start > 0,
        nextBeforeId: messages.length ? messages[0].id : beforeId || null,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/delete', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      try {
        await deleteConversationSafely(conversationId, req.session.user.id);
      } catch (error) {
        if (error.code === 'CONVERSATION_NOT_FOUND') {
          return renderPage(res, 'message', { title: '提示', message: '会话不存在或无权删除。' });
        }
        throw error;
      }

      return res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerChatPageRoutes };
