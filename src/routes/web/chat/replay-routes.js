/**
 * @file src/routes/web/chat/replay-routes.js
 * @description 聊天路由子分组。
 */

function registerChatReplayRoutes(app, ctx) {
  const {
    requireAuth,
    getMessageById,
    addMessage,
    fetchPathMessages,
    invalidateConversationCache,
    generateReplyViaGateway,
    renderPage,
    parseIdParam,
    renderChatPage,
    loadConversationForUserOrFail,
    buildConversationCharacterPayload,
    buildChatMessagePacket,
    createNdjsonResponder,
    streamChatReplyToNdjson
  } = ctx;

  app.post('/chat/:conversationId/messages/:messageId/replay/stream', requireAuth, async (req, res, next) => {
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
      if (!targetMessage) {
        ndjson.safeWrite({ type: 'error', message: '找不到要重写的位置。' });
        ndjson.end();
        return;
      }
      if (!targetMessage.parent_message_id) {
        ndjson.safeWrite({ type: 'error', message: '这里还没有可重写的后续。' });
        ndjson.end();
        return;
      }

      const historyBeforeTarget = await fetchPathMessages(conversationId, targetMessage.parent_message_id);
      let newLeafId = null;
      let previewUserContent = '';
      let reply = '';

      if (targetMessage.sender_type === 'user') {
        const newUserMessageId = await addMessage({
          conversationId,
          senderType: 'user',
          content: targetMessage.content,
          parentMessageId: targetMessage.parent_message_id || null,
          branchFromMessageId: targetMessage.id,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'user-rewrite-continuation',
            sourceMessageId: messageId,
            delivery: 'stream',
          }),
        });

        previewUserContent = targetMessage.content;
        const userPacket = await buildChatMessagePacket(req, conversation, newUserMessageId, newUserMessageId);
        ndjson.safeWrite({ type: 'user-message', conversationId, userMessageId: newUserMessageId, content: previewUserContent, messageId: newUserMessageId, leafId: newUserMessageId, mode: 'replay', html: userPacket ? userPacket.html : '' });
        ndjson.safeWrite({ type: 'assistant-start', conversationId, parentMessageId: newUserMessageId, sourceMessageId: messageId, mode: 'replay' });

        reply = await streamChatReplyToNdjson({
          requestId: req.requestId,
          userId: req.session.user.id,
          conversationId,
          character: buildConversationCharacterPayload(conversation),
          messages: historyBeforeTarget,
          userMessage: targetMessage.content,
          systemHint: '这是一次从较早位置开始重写后续，请自然延续并给出新的合理内容。',
          promptKind: 'replay',
          modelMode: conversation.selected_model_mode || 'standard',
          signal: ndjson.abortController.signal,
          safeWrite: ndjson.safeWrite,
          user: req.session.user,
        });

        if (ndjson.isClosed() || ndjson.abortController.signal.aborted) {
          return;
        }

        newLeafId = await addMessage({
          conversationId,
          senderType: 'character',
          content: reply,
          parentMessageId: newUserMessageId,
          branchFromMessageId: newUserMessageId,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'assistant-replay-after-user-stream',
            sourceMessageId: messageId,
          }),
        });
      } else {
        const parentUserMessage = await getMessageById(conversationId, targetMessage.parent_message_id);
        if (!parentUserMessage || parentUserMessage.sender_type !== 'user') {
          ndjson.safeWrite({ type: 'error', message: '找不到与这条 AI 回复对应的用户输入。' });
          ndjson.end();
          return;
        }

        const historyBeforeParentUser = parentUserMessage.parent_message_id
          ? await fetchPathMessages(conversationId, parentUserMessage.parent_message_id)
          : [];

        const newUserMessageId = await addMessage({
          conversationId,
          senderType: 'user',
          content: parentUserMessage.content,
          parentMessageId: parentUserMessage.parent_message_id || null,
          branchFromMessageId: parentUserMessage.id,
          editedFromMessageId: parentUserMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'user-replay-copy-for-ai',
            sourceMessageId: parentUserMessage.id,
            delivery: 'stream',
          }),
        });

        previewUserContent = parentUserMessage.content;
        const userPacket = await buildChatMessagePacket(req, conversation, newUserMessageId, newUserMessageId);
        ndjson.safeWrite({ type: 'user-message', conversationId, userMessageId: newUserMessageId, content: previewUserContent, messageId: newUserMessageId, leafId: newUserMessageId, mode: 'replay', html: userPacket ? userPacket.html : '' });
        ndjson.safeWrite({ type: 'assistant-start', conversationId, parentMessageId: newUserMessageId, sourceMessageId: messageId, mode: 'replay' });

        reply = await streamChatReplyToNdjson({
          requestId: req.requestId,
          userId: req.session.user.id,
          conversationId,
          character: buildConversationCharacterPayload(conversation),
          messages: historyBeforeParentUser,
          userMessage: parentUserMessage.content,
          systemHint: '这是一次从较早 AI 回复开始重写后续，请给出不同但合理的新内容。',
          promptKind: 'replay',
          modelMode: conversation.selected_model_mode || 'standard',
          signal: ndjson.abortController.signal,
          safeWrite: ndjson.safeWrite,
          user: req.session.user,
        });

        if (ndjson.isClosed() || ndjson.abortController.signal.aborted) {
          return;
        }

        newLeafId = await addMessage({
          conversationId,
          senderType: 'character',
          content: reply,
          parentMessageId: newUserMessageId,
          branchFromMessageId: newUserMessageId,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'assistant-replay-after-ai-stream',
            sourceMessageId: messageId,
          }),
        });
      }

      await invalidateConversationCache(conversationId);
      const replyPacket = await buildChatMessagePacket(req, conversation, newLeafId, newLeafId);
      const newLeafMessage = await getMessageById(conversationId, newLeafId);
      const parentPacket = newLeafMessage && newLeafMessage.parent_message_id
        ? await buildChatMessagePacket(req, conversation, newLeafId, newLeafMessage.parent_message_id)
        : null;
      ndjson.safeWrite({
        type: 'done',
        conversationId,
        replyMessageId: newLeafId,
        messageId: newLeafId,
        leafId: newLeafId,
        full: reply,
        mode: 'replay',
        html: replyPacket ? replyPacket.html : '',
        parentMessageId: newLeafMessage ? newLeafMessage.parent_message_id : null,
        parentHtml: parentPacket ? parentPacket.html : '',
        preview: [
          { role: '你', content: previewUserContent },
          { role: conversation.character_name, content: reply },
        ],
      });
      ndjson.end();
    } catch (error) {
      if (!res.headersSent) {
        return next(error);
      }
      ndjson.fail(error);
    }
  });

  app.post('/chat/:conversationId/messages/:messageId/replay', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage) {
        return renderPage(res, 'message', { title: '提示', message: '找不到要重写的位置。' });
      }
      if (!targetMessage.parent_message_id) {
        return renderPage(res, 'message', { title: '提示', message: '这里还没有可重写的后续。' });
      }

      const historyBeforeTarget = await fetchPathMessages(conversationId, targetMessage.parent_message_id);
      let newLeafId = null;
      let newContinuationPreview = [];

      if (targetMessage.sender_type === 'user') {
        const newUserMessageId = await addMessage({
          conversationId,
          senderType: 'user',
          content: targetMessage.content,
          parentMessageId: targetMessage.parent_message_id || null,
          branchFromMessageId: targetMessage.id,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'user-rewrite-continuation',
            sourceMessageId: messageId,
          }),
        });

        const reply = await generateReplyViaGateway({
          requestId: req.requestId,
          userId: req.session.user.id,
          conversationId,
          character: buildConversationCharacterPayload(conversation),
          messages: historyBeforeTarget,
          userMessage: targetMessage.content,
          systemHint: '这是一次从较早位置开始重写后续，请自然延续并给出新的合理内容。',
          promptKind: 'replay',
          modelMode: conversation.selected_model_mode || 'standard',
          user: req.session.user,
        });

        newLeafId = await addMessage({
          conversationId,
          senderType: 'character',
          content: reply,
          parentMessageId: newUserMessageId,
          branchFromMessageId: newUserMessageId,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'assistant-replay-after-user',
            sourceMessageId: messageId,
          }),
        });

        newContinuationPreview = [
          { role: '你', content: targetMessage.content },
          { role: conversation.character_name, content: reply },
        ];
      } else {
        const parentUserMessage = await getMessageById(conversationId, targetMessage.parent_message_id);
        if (!parentUserMessage || parentUserMessage.sender_type !== 'user') {
          return renderPage(res, 'message', { title: '提示', message: '找不到与这条 AI 回复对应的用户输入。' });
        }

        const historyBeforeParentUser = parentUserMessage.parent_message_id
          ? await fetchPathMessages(conversationId, parentUserMessage.parent_message_id)
          : [];

        const newUserMessageId = await addMessage({
          conversationId,
          senderType: 'user',
          content: parentUserMessage.content,
          parentMessageId: parentUserMessage.parent_message_id || null,
          branchFromMessageId: parentUserMessage.id,
          editedFromMessageId: parentUserMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'user-replay-copy-for-ai',
            sourceMessageId: parentUserMessage.id,
          }),
        });

        const reply = await generateReplyViaGateway({
          requestId: req.requestId,
          userId: req.session.user.id,
          conversationId,
          character: buildConversationCharacterPayload(conversation),
          messages: historyBeforeParentUser,
          userMessage: parentUserMessage.content,
          systemHint: '这是一次从较早 AI 回复开始重写后续，请给出不同但合理的新内容。',
          promptKind: 'replay',
          modelMode: conversation.selected_model_mode || 'standard',
          user: req.session.user,
        });

        newLeafId = await addMessage({
          conversationId,
          senderType: 'character',
          content: reply,
          parentMessageId: newUserMessageId,
          branchFromMessageId: newUserMessageId,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'assistant-replay-after-ai',
            sourceMessageId: messageId,
          }),
        });

        newContinuationPreview = [
          { role: '你', content: parentUserMessage.content },
          { role: conversation.character_name, content: reply },
        ];
      }

      await renderChatPage(req, res, conversation, {
        leafId: newLeafId,
        persistLeaf: true,
        newContinuationPreview,
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerChatReplayRoutes };
