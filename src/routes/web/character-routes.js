/**
 * @file src/routes/web/character-routes.js
 * @description 从 web-routes.js 拆出的路由分组。
 */

function registerCharacterRoutes(app, ctx) {
  const {
    requireAuth,
    createCharacter,
    updateCharacter,
    getCharacterById,
    deleteCharacterSafely,
    markCharacterUsed,
    applyRuntimeTemplate,
    createConversation,
    addMessage,
    renderPage,
    parseIdParam,
    resolveAllowedInitialModelMode,
    splitCharacterPromptProfile,
    buildCharacterPromptProfileFromForm
  } = ctx;

  app.get('/characters/new', requireAuth, (req, res) => {
    renderPage(res, 'character-new', {
      title: '创建角色',
      mode: 'create',
      form: { visibility: 'public' },
      extraPromptItems: [],
    });
  });

  app.get('/characters/:characterId/edit', requireAuth, async (req, res, next) => {
    try {
      const characterId = parseIdParam(req.params.characterId, '角色 ID');
      const character = await getCharacterById(characterId, req.session.user.id);
      if (!character) {
        return renderPage(res, 'message', { title: '提示', message: '角色不存在或无权编辑。' });
      }

      const { structured, extraItems } = splitCharacterPromptProfile(character.prompt_profile_json);

      renderPage(res, 'character-new', {
        title: '编辑角色',
        mode: 'edit',
        character,
        form: {
          name: character.name,
          summary: character.summary,
          role: structured.role,
          traitDescription: structured.traitDescription || character.personality,
          currentScene: structured.currentScene,
          currentBackground: structured.currentBackground,
          firstMessage: character.first_message,
          visibility: character.visibility === 'private' ? 'private' : 'public',
        },
        extraPromptItems: extraItems,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/characters/new', requireAuth, async (req, res, next) => {
    try {
      const promptProfileItems = buildCharacterPromptProfileFromForm(req.body);
      const payload = {
        name: String(req.body.name || '').trim(),
        summary: String(req.body.summary || '').trim(),
        personality: String(req.body.traitDescription || '').trim(),
        firstMessage: String(req.body.firstMessage || '').trim(),
        promptProfileJson: JSON.stringify(promptProfileItems),
        visibility: String(req.body.visibility || 'public').trim() === 'private' ? 'private' : 'public',
      };

      await createCharacter(req.session.user.id, payload);
      return res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  });

  app.post('/characters/:characterId/edit', requireAuth, async (req, res, next) => {
    try {
      const characterId = parseIdParam(req.params.characterId, '角色 ID');
      const character = await getCharacterById(characterId, req.session.user.id);
      if (!character) {
        return renderPage(res, 'message', { title: '提示', message: '角色不存在或无权编辑。' });
      }

      const promptProfileItems = buildCharacterPromptProfileFromForm(req.body);
      const payload = {
        name: String(req.body.name || '').trim(),
        summary: String(req.body.summary || '').trim(),
        personality: String(req.body.traitDescription || '').trim(),
        firstMessage: String(req.body.firstMessage || '').trim(),
        promptProfileJson: JSON.stringify(promptProfileItems),
        visibility: String(req.body.visibility || 'public').trim() === 'private' ? 'private' : 'public',
      };

      await updateCharacter(characterId, req.session.user.id, payload);
      return res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  });

  app.post('/characters/:characterId/delete', requireAuth, async (req, res, next) => {
    try {
      const characterId = parseIdParam(req.params.characterId, '角色 ID');
      try {
        await deleteCharacterSafely(characterId, req.session.user.id);
      } catch (error) {
        if (error.code === 'CHARACTER_NOT_FOUND') {
          return renderPage(res, 'message', { title: '提示', message: '角色不存在或无权删除。' });
        }
        if (error.code === 'CHARACTER_HAS_CONVERSATIONS') {
          return renderPage(res, 'message', {
            title: '暂时不能删除角色',
            message: `这个角色下面还有 ${error.conversationCount} 条对话记录。为了保护已有内容，现在只允许删除“从未开过对话”的角色。你可以先保留角色，或后面再做更细的归档/迁移方案。`,
          });
        }
        throw error;
      }

      return res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  });

  app.post('/conversations/start/:characterId', requireAuth, async (req, res, next) => {
    try {
      const characterId = parseIdParam(req.params.characterId, '角色 ID');
      let character = await getCharacterById(characterId, req.session.user.id);

      if (!character) {
        character = await getCharacterById(characterId);
      }

      if (!character || (character.visibility !== 'public' && Number(character.user_id) !== Number(req.session.user.id))) {
        return renderPage(res, 'message', { title: '提示', message: '角色不存在。' });
      }

      const selectedModelMode = await resolveAllowedInitialModelMode(req.session.user.id, req.body.modelMode);
      const conversationId = await createConversation(req.session.user.id, characterId, {
        title: `${character.name} · 新对话`,
        selectedModelMode,
      });
      await markCharacterUsed(characterId, req.session.user.id);

      if (String(character.first_message || '').trim()) {
        const userMessageId = await addMessage({
          conversationId,
          senderType: 'user',
          content: '[开始一次新的对话]',
          promptKind: 'conversation-start',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'conversation-start-user-seed',
            autoGenerated: true,
          }),
        });

        const replyMessageId = await addMessage({
          conversationId,
          senderType: 'character',
          content: applyRuntimeTemplate(String(character.first_message || '').trim(), { username: req.session.user.username, user: req.session.user.username, timeZone: 'Asia/Hong_Kong' }),
          parentMessageId: userMessageId,
          branchFromMessageId: userMessageId,
          promptKind: 'first-message',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'character-first-message',
          }),
        });

        return res.redirect(`/chat/${conversationId}?leaf=${replyMessageId}`);
      }

      return res.redirect(`/chat/${conversationId}`);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerCharacterRoutes };
