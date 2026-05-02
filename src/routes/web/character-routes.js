/**
 * @file src/routes/web/character-routes.js
 * @description 从 web-routes.js 拆出的路由分组。
 */

function registerCharacterRoutes(app, ctx) {
  const {
    requireAuth,
    ensureCharacterImageColumns,
    createCharacter,
    updateCharacter,
    getCharacterById,
    deleteCharacterSafely,
    uploadCharacterImages,
    getUploadedCharacterImagePaths,
    cleanupUploadedCharacterFiles,
    deleteStoredImageIfOwned,
    markCharacterUsed,
    applyRuntimeTemplate,
    createConversation,
    addMessage,
    renderPage,
    parseIdParam,
    resolveAllowedInitialModelMode,
    splitCharacterPromptProfile,
    buildCharacterPromptProfileFromForm,
    clampCharacterField,
  } = ctx;

  app.get('/characters/new', requireAuth, (req, res) => {
    renderPage(res, 'character-new', {
      title: '创建角色',
      mode: 'create',
      form: { visibility: 'public', avatarImagePath: '', backgroundImagePath: '' },
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
          avatarImagePath: character.avatar_image_path || '',
          backgroundImagePath: character.background_image_path || '',
          isNsfw: Number(character.is_nsfw || 0) === 1,
          tagsText: Array.isArray(character.tags) ? character.tags.map(tag => tag.name).join(', ') : '',
        },
        extraPromptItems: extraItems,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/characters/new', requireAuth, uploadCharacterImages, async (req, res, next) => {
    try {
      await ensureCharacterImageColumns();
      const uploadedPaths = getUploadedCharacterImagePaths(req.files);
      const promptProfileItems = buildCharacterPromptProfileFromForm(req.body);
      const payload = {
        name: clampCharacterField(req.body.name),
        summary: clampCharacterField(req.body.summary),
        personality: clampCharacterField(req.body.traitDescription),
        firstMessage: clampCharacterField(req.body.firstMessage),
        promptProfileJson: JSON.stringify(promptProfileItems),
        visibility: String(req.body.visibility || 'public').trim() === 'private' ? 'private' : 'public',
        isNsfw: String(req.body.isNsfw || '').trim() === '1',
        tags: req.body.tags,
        avatarImagePath: uploadedPaths.avatarImagePath,
        backgroundImagePath: uploadedPaths.backgroundImagePath,
      };

      await createCharacter(req.session.user.id, payload);
      return res.redirect('/dashboard');
    } catch (error) {
      cleanupUploadedCharacterFiles(req.files);
      next(error);
    }
  });

  app.post('/characters/:characterId/edit', requireAuth, uploadCharacterImages, async (req, res, next) => {
    try {
      const characterId = parseIdParam(req.params.characterId, '角色 ID');
      await ensureCharacterImageColumns();
      const character = await getCharacterById(characterId, req.session.user.id);
      if (!character) {
        cleanupUploadedCharacterFiles(req.files);
        return renderPage(res, 'message', { title: '提示', message: '角色不存在或无权编辑。' });
      }

      const uploadedPaths = getUploadedCharacterImagePaths(req.files);
      const avatarImagePath = uploadedPaths.avatarImagePath || character.avatar_image_path || null;
      const backgroundImagePath = uploadedPaths.backgroundImagePath || character.background_image_path || null;
      const promptProfileItems = buildCharacterPromptProfileFromForm(req.body);
      const payload = {
        name: clampCharacterField(req.body.name),
        summary: clampCharacterField(req.body.summary),
        personality: clampCharacterField(req.body.traitDescription),
        firstMessage: clampCharacterField(req.body.firstMessage),
        promptProfileJson: JSON.stringify(promptProfileItems),
        visibility: String(req.body.visibility || 'public').trim() === 'private' ? 'private' : 'public',
        isNsfw: String(req.body.isNsfw || '').trim() === '1',
        tags: req.body.tags,
        avatarImagePath,
        backgroundImagePath,
      };

      await updateCharacter(characterId, req.session.user.id, payload);
      if (uploadedPaths.avatarImagePath && character.avatar_image_path) {
        deleteStoredImageIfOwned(character.avatar_image_path);
      }
      if (uploadedPaths.backgroundImagePath && character.background_image_path) {
        deleteStoredImageIfOwned(character.background_image_path);
      }
      return res.redirect('/dashboard');
    } catch (error) {
      cleanupUploadedCharacterFiles(req.files);
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
      if (character.visibility === 'public' && Number(character.is_nsfw || 0) === 1 && Number(character.user_id) !== Number(req.session.user.id) && Number(req.session.user.show_nsfw || 0) !== 1) {
        return renderPage(res, 'message', { title: '提示', message: '这个角色设置为 NSFW。请先在个人资料页开启 NSFW 显示后再开始聊天。' });
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
