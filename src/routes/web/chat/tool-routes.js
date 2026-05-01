/**
 * @file src/routes/web/chat/tool-routes.js
 * @description 聊天路由子分组。
 */

function registerChatToolRoutes(app, ctx) {
  const {
    requireAuth,
    updateConversationModelMode,
    getMessageById,
    getLatestMessage,
    fetchPathMessages,
    cloneConversationBranch,
    optimizeUserInputViaGateway,
    getChatModelSelector,
    renderPage,
    parseIntegerField,
    parseIdParam,
    buildConversationTitle,
    renderChatPage,
    loadConversationForUserOrFail,
    buildConversationCharacterPayload,
    createNdjsonResponder,
    streamOptimizedInputToNdjson
  } = ctx;

  app.post('/chat/:conversationId/model', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const selectedModelMode = normalizeModelKey(req.body.modelMode, DEFAULT_MODEL_KEY);
      const chatModelSelector = await getChatModelSelector(req.session.user.id);
      const allowedModelModes = new Set((chatModelSelector.options || []).map((option) => option.mode));
      if (!allowedModelModes.has(selectedModelMode)) {
        return renderPage(res, 'message', { title: '提示', message: '当前套餐不支持这个模型。' });
      }

      await updateConversationModelMode(conversationId, selectedModelMode);
      return res.redirect(`/chat/${conversationId}?leaf=${conversation.current_message_id || ''}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/optimize-input/stream', requireAuth, async (req, res, next) => {
    const ndjson = createNdjsonResponder(req, res);
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const content = String(req.body.content || '').trim();
      const parentMessageId = parseIntegerField(req.body.parentMessageId, { fieldLabel: '父消息 ID', min: 1, allowEmpty: true });
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        ndjson.end();
        return;
      }
      if (!content) {
        ndjson.safeWrite({ type: 'error', message: '内容不能为空。' });
        ndjson.end();
        return;
      }

      const latestMessage = parentMessageId || conversation.current_message_id ? null : await getLatestMessage(conversationId);
      const contextLeafId = parentMessageId || conversation.current_message_id || latestMessage?.id || null;
      const history = await fetchPathMessages(conversationId, contextLeafId);
      ndjson.safeWrite({
        type: 'assistant-start',
        conversationId,
        parentMessageId: contextLeafId,
        mode: 'optimize-input',
      });

      const optimizedContent = await streamOptimizedInputToNdjson({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: buildConversationCharacterPayload(conversation),
        messages: history,
        userInput: content,
        modelMode: conversation.selected_model_mode || 'standard',
        signal: ndjson.abortController.signal,
        safeWrite: ndjson.safeWrite,
        user: req.session.user,
      });

      if (ndjson.isClosed() || ndjson.abortController.signal.aborted) {
        return;
      }

      ndjson.safeWrite({
        type: 'done',
        conversationId,
        leafId: contextLeafId,
        full: optimizedContent,
        mode: 'optimize-input',
        draftContent: content,
        optimizedContent,
      });
      ndjson.end();
    } catch (error) {
      if (!res.headersSent) {
        return next(error);
      }
      ndjson.fail(error);
    }
  });

  app.post('/chat/:conversationId/optimize-input', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const content = String(req.body.content || '').trim();
      const parentMessageId = parseIntegerField(req.body.parentMessageId, { fieldLabel: '父消息 ID', min: 1, allowEmpty: true });
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }
      if (!content) {
        return renderPage(res, 'message', { title: '提示', message: '内容不能为空。' });
      }

      const latestMessage = parentMessageId || conversation.current_message_id ? null : await getLatestMessage(conversationId);
      const contextLeafId = parentMessageId || conversation.current_message_id || latestMessage?.id || null;
      const history = await fetchPathMessages(conversationId, contextLeafId);
      const optimizedContent = await optimizeUserInputViaGateway({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: buildConversationCharacterPayload(conversation),
        messages: history,
        userInput: content,
        modelMode: conversation.selected_model_mode || 'standard',
        user: req.session.user,
      });

      await renderChatPage(req, res, conversation, {
        leafId: contextLeafId,
        persistLeaf: true,
        draftContent: content,
        optimizedContent,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/branch/:messageId', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage) {
        return renderPage(res, 'message', { title: '提示', message: '找不到要复制的位置。' });
      }

      const branchTitle = buildConversationTitle(conversation.character_name, targetMessage.content);
      const branchResult = await cloneConversationBranch({
        userId: req.session.user.id,
        characterId: conversation.character_id,
        sourceConversationId: conversation.id,
        sourceLeafMessageId: messageId,
        selectedModelMode: conversation.selected_model_mode || 'standard',
        title: branchTitle,
      });

      return res.redirect(`/chat/${branchResult.conversationId}?leaf=${branchResult.leafMessageId}`);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerChatToolRoutes };
