/**
 * @file src/routes/web/chat/regenerate-routes.js
 * @description 聊天路由子分组。
 */

function registerChatRegenerateRoutes(app, ctx) {
  const {
    requireAuth,
    getMessageById,
    addMessage,
    fetchPathMessages,
    invalidateConversationCache,
    generateReplyViaGateway,
    renderPage,
    parseIdParam,
    loadConversationForUserOrFail,
    buildConversationCharacterPayload,
    buildChatMessagePacket,
    createNdjsonResponder,
    streamChatReplyToNdjson
  } = ctx;

  app.post('/chat/:conversationId/regenerate/:messageId/stream', requireAuth, async (req, res, next) => {
    const ndjson = createNdjsonResponder(req, res);
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        ndjson.end();
        return;
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage || targetMessage.sender_type !== 'character') {
        ndjson.safeWrite({ type: 'error', message: '只能重新生成 AI 回复。' });
        ndjson.end();
        return;
      }

      const parentUserMessage = targetMessage.parent_message_id
        ? await getMessageById(conversationId, targetMessage.parent_message_id)
        : null;

      if (!parentUserMessage || parentUserMessage.sender_type !== 'user') {
        ndjson.safeWrite({ type: 'error', message: '找不到对应的用户输入。' });
        ndjson.end();
        return;
      }

      const history = (await fetchPathMessages(conversationId, parentUserMessage.id)).slice(0, -1);
      ndjson.safeWrite({
        type: 'assistant-start',
        conversationId,
        parentMessageId: parentUserMessage.id,
        sourceMessageId: messageId,
        mode: 'regenerate',
      });

      const reply = await streamChatReplyToNdjson({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: buildConversationCharacterPayload(conversation),
        messages: history,
        userMessage: parentUserMessage.content,
        systemHint: '这是一次重新生成。请在保持角色一致的前提下，给出与先前不同但同样合理的新回复。',
        promptKind: 'regenerate',
        modelMode: conversation.selected_model_mode || 'standard',
        signal: ndjson.abortController.signal,
        safeWrite: ndjson.safeWrite,
        user: req.session.user,
      });

      if (ndjson.isClosed() || ndjson.abortController.signal.aborted) {
        return;
      }

      const newReplyId = await addMessage({
        conversationId,
        senderType: 'character',
        content: reply,
        parentMessageId: parentUserMessage.id,
        branchFromMessageId: messageId,
        editedFromMessageId: messageId,
        promptKind: 'regenerate',
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'assistant-regenerate-stream',
          sourceMessageId: messageId,
        }),
      });

      await invalidateConversationCache(conversationId);
      const replyPacket = await buildChatMessagePacket(req, conversation, newReplyId, newReplyId);
      ndjson.safeWrite({
        type: 'done',
        conversationId,
        replyMessageId: newReplyId,
        messageId: newReplyId,
        leafId: newReplyId,
        full: reply,
        mode: 'regenerate',
        html: replyPacket ? replyPacket.html : '',
        parentMessageId: parentUserMessage.id,
      });
      ndjson.end();
    } catch (error) {
      if (!res.headersSent) {
        return next(error);
      }
      ndjson.fail(error);
    }
  });

  app.post('/chat/:conversationId/regenerate/:messageId', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage || targetMessage.sender_type !== 'character') {
        return renderPage(res, 'message', { title: '提示', message: '只能重新生成 AI 回复。' });
      }

      const parentUserMessage = targetMessage.parent_message_id
        ? await getMessageById(conversationId, targetMessage.parent_message_id)
        : null;

      if (!parentUserMessage || parentUserMessage.sender_type !== 'user') {
        return renderPage(res, 'message', { title: '提示', message: '找不到对应的用户输入。' });
      }

      const history = (await fetchPathMessages(conversationId, parentUserMessage.id)).slice(0, -1);
      const reply = await generateReplyViaGateway({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: buildConversationCharacterPayload(conversation),
        messages: history,
        userMessage: parentUserMessage.content,
        systemHint: '这是一次重新生成。请在保持角色一致的前提下，给出与先前不同但同样合理的新回复。',
        promptKind: 'regenerate',
        modelMode: conversation.selected_model_mode || 'standard',
        user: req.session.user,
      });

      const newReplyId = await addMessage({
        conversationId,
        senderType: 'character',
        content: reply,
        parentMessageId: parentUserMessage.id,
        branchFromMessageId: messageId,
        editedFromMessageId: messageId,
        promptKind: 'regenerate',
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'assistant-regenerate',
          sourceMessageId: messageId,
        }),
      });

      return res.redirect(`/chat/${conversationId}?leaf=${newReplyId}`);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerChatRegenerateRoutes };
