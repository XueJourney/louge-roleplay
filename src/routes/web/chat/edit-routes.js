/**
 * @file src/routes/web/chat/edit-routes.js
 * @description 聊天路由子分组。
 */

function registerChatEditRoutes(app, ctx) {
  const {
    requireAuth,
    getMessageById,
    addMessage,
    createEditedMessageVariant,
    fetchPathMessages,
    deleteMessageSafely,
    generateReplyViaGateway,
    renderPage,
    parseIdParam,
    renderChatPage,
    loadConversationForUserOrFail
  } = ctx;

  app.post('/chat/:conversationId/messages/:messageId/delete', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      try {
        const result = await deleteMessageSafely(conversationId, messageId, req.session.user.id);
        const nextLeaf = result.fallbackMessageId || '';
        return res.redirect(nextLeaf ? `/chat/${conversationId}?leaf=${nextLeaf}` : `/chat/${conversationId}`);
      } catch (error) {
        if (error.code === 'MESSAGE_NOT_FOUND') {
          return renderPage(res, 'message', { title: '提示', message: '这条对话记录不存在。' });
        }
        if (error.code === 'MESSAGE_HAS_CHILDREN') {
          return renderChatPage(req, res, conversation, {
            leafId: conversation.current_message_id || null,
            errorMessage: `这条消息后面还有 ${error.childMessageCount} 条内容。请先处理后续内容，再删除这里。`,
          });
        }
        if (error.code === 'MESSAGE_HAS_BRANCH_CONVERSATIONS') {
          return renderChatPage(req, res, conversation, {
            leafId: conversation.current_message_id || null,
            errorMessage: `这条消息还被 ${error.branchConversationCount} 条独立对话引用，暂时不能删除。`,
          });
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/messages/:messageId/edit', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const content = String(req.body.content || '').trim();
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }
      if (!content) {
        return renderPage(res, 'message', { title: '提示', message: '内容不能为空。' });
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage || targetMessage.sender_type !== 'character') {
        return renderPage(res, 'message', { title: '提示', message: '这里只支持修改 AI 生成内容。' });
      }

      const variantMessageId = await createEditedMessageVariant(conversationId, messageId, content);
      return res.redirect(`/chat/${conversationId}?leaf=${variantMessageId}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/messages/:messageId/edit-user', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const content = String(req.body.content || '').trim();
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }
      if (!content) {
        return renderPage(res, 'message', { title: '提示', message: '内容不能为空。' });
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage || targetMessage.sender_type !== 'user') {
        return renderPage(res, 'message', { title: '提示', message: '这里只支持修改用户输入。' });
      }

      const historyBeforeUser = targetMessage.parent_message_id
        ? await fetchPathMessages(conversationId, targetMessage.parent_message_id)
        : [];

      const newUserMessageId = await addMessage({
        conversationId,
        senderType: 'user',
        content,
        parentMessageId: targetMessage.parent_message_id || null,
        branchFromMessageId: targetMessage.id,
        editedFromMessageId: targetMessage.id,
        promptKind: 'edit',
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'user-edit-resend',
          sourceMessageId: messageId,
        }),
      });

      const reply = await generateReplyViaGateway({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: {
          name: conversation.character_name,
          summary: conversation.character_summary,
          personality: conversation.personality,
          prompt_profile_json: conversation.prompt_profile_json,
        },
        messages: historyBeforeUser,
        userMessage: content,
        systemHint: '这是基于用户修改后的输入重新生成回复，请自然延续，不要提到内部操作。',
        promptKind: 'edit',
        modelMode: conversation.selected_model_mode || 'standard',
        user: req.session.user,
      });

      const replyMessageId = await addMessage({
        conversationId,
        senderType: 'character',
        content: reply,
        parentMessageId: newUserMessageId,
        branchFromMessageId: newUserMessageId,
        promptKind: 'edit',
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'assistant-reply-from-user-edit',
          sourceMessageId: messageId,
        }),
      });

      return res.redirect(`/chat/${conversationId}?leaf=${replyMessageId}`);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerChatEditRoutes };
