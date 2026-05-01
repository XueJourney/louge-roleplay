/**
 * @file src/routes/web/admin-routes.js
 * @description 从 web-routes.js 拆出的路由分组。
 */

function registerAdminRoutes(app, ctx) {
  const {
    requireAdmin,
    updateUserRole,
    listPlans,
    findPlanById,
    createPlan,
    updatePlan,
    deletePlan,
    updateUserPlan,
    listUsersWithPlans,
    getAdminOverview,
    listLogEntries,
    DEFAULT_SUPPORT_QR_URL,
    listNotificationsForAdmin,
    listActiveNotificationsForUser,
    createNotification,
    updateNotification,
    deleteNotification,
    getAdminConversationDetail,
    listAdminConversations,
    permanentlyDeleteConversation,
    permanentlyDeleteMessage,
    restoreConversation,
    restoreMessage,
    listProviders,
    createProvider,
    updateProvider,
    listPromptBlocks,
    createPromptBlock,
    updatePromptBlock,
    reorderPromptBlocks,
    deletePromptBlock,
    buildPromptPreview,
    invalidateConversationCache,
    query,
    renderPage,
    renderValidationMessage,
    parseIntegerField,
    parseNumberField,
    parseIdParam
  } = ctx;

  app.get('/admin', requireAdmin, async (req, res, next) => {
    try {
      const [overview, users, plans] = await Promise.all([
        getAdminOverview(),
        listUsersWithPlans(),
        listPlans(),
      ]);

      renderPage(res, 'admin', {
        title: '管理员后台',
        overview,
        users,
        plans,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/plans', requireAdmin, async (req, res, next) => {
    try {
      const [overview, plans] = await Promise.all([
        getAdminOverview(),
        listPlans(),
      ]);

      renderPage(res, 'admin-plans', {
        title: '套餐配置',
        overview,
        plans,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/providers', requireAdmin, async (req, res, next) => {
    try {
      const [overview, providers] = await Promise.all([
        getAdminOverview(),
        listProviders(),
      ]);

      renderPage(res, 'admin-providers', {
        title: 'LLM 配置',
        overview,
        providers,
      });
    } catch (error) {
      next(error);
    }
  });

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

  app.get('/admin/prompts', requireAdmin, async (req, res, next) => {
    try {
      const promptBlocks = await listPromptBlocks();
      const promptPreview = buildPromptPreview({
        promptBlocks: promptBlocks.map((item) => ({
          key: item.block_key,
          value: item.block_value,
          sortOrder: item.sort_order,
          isEnabled: item.is_enabled,
        })),
        character: {},
      });

      const promptPreviewMeta = {
        modeLabel: '纯全局片段预览',
        description: '这里只展示当前启用的全局提示词片段拼接结果，不再注入任何示例角色字段占位。',
      };

      renderPage(res, 'admin-prompts', {
        title: 'Prompt 配置',
        promptBlocks,
        promptPreview,
        promptPreviewMeta,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/logs', requireAdmin, async (req, res, next) => {
    try {
      const logResult = listLogEntries({
        date: req.query.date,
        level: req.query.level,
        file: req.query.file,
        errorType: req.query.errorType,
        functionName: req.query.functionName,
        page: parseIntegerField(req.query.page, { fieldLabel: '页码', defaultValue: 1, min: 1 }),
        pageSize: parseIntegerField(req.query.pageSize, { fieldLabel: '分页大小', defaultValue: 50, min: 1 }),
      });

      const buildPageUrl = (targetPage) => {
        const params = new URLSearchParams();
        Object.entries({ ...logResult.filters, page: targetPage, pageSize: logResult.pageSize }).forEach(([key, value]) => {
          if (value !== undefined && value !== null && String(value).trim() !== '') {
            params.set(key, String(value));
          }
        });
        return `/admin/logs?${params.toString()}`;
      };

      renderPage(res, 'admin-logs', {
        title: '日志查询',
        logResult,
        buildPageUrl,
      });
    } catch (error) {
      next(error);
    }
  });

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

      const buildPageUrl = (targetPage) => {
        const params = new URLSearchParams();
        Object.entries({
          ...conversationResult.filters,
          page: targetPage,
          pageSize: conversationResult.pageSize,
        }).forEach(([key, value]) => {
          if (value !== undefined && value !== null && String(value).trim() !== '' && Number(value) !== 0) {
            params.set(key, String(value));
          }
        });
        return `/admin/conversations?${params.toString()}`;
      };

      renderPage(res, 'admin-conversations', {
        title: '全局对话记录',
        conversationResult,
        buildPageUrl,
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

  app.post('/admin/plans/new', requireAdmin, async (req, res, next) => {
    try {
      const code = String(req.body.code || '').trim();
      const name = String(req.body.name || '').trim();
      if (!code || !name) {
        return renderValidationMessage(res, '新增套餐时，code 和 name 不能为空。');
      }

      await createPlan({
        code,
        name,
        description: String(req.body.description || '').trim(),
        billingMode: String(req.body.billingMode || 'per_request').trim(),
        quotaPeriod: String(req.body.quotaPeriod || 'monthly').trim(),
        requestQuota: parseIntegerField(req.body.requestQuota, { fieldLabel: '请求额度', defaultValue: 0, min: 0 }),
        tokenQuota: parseIntegerField(req.body.tokenQuota, { fieldLabel: 'Token 额度', defaultValue: 0, min: 0 }),
        priorityWeight: parseIntegerField(req.body.priorityWeight, { fieldLabel: '优先级权重', defaultValue: 0, min: 0 }),
        concurrencyLimit: parseIntegerField(req.body.concurrencyLimit, { fieldLabel: '并发上限', defaultValue: 1, min: 1 }),
        maxOutputTokens: parseIntegerField(req.body.maxOutputTokens, { fieldLabel: '最大输出 Token', defaultValue: 1024, min: 1 }),
        status: String(req.body.status || 'active').trim(),
        isDefault: String(req.body.isDefault || '') === '1',
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/plans');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/plans/:planId', requireAdmin, async (req, res, next) => {
    try {
      const planId = parseIdParam(req.params.planId, '套餐 ID');
      const plan = await findPlanById(planId);
      if (!plan) {
        return renderValidationMessage(res, '套餐不存在。');
      }

      await updatePlan(planId, {
        name: String(req.body.name || '').trim(),
        description: String(req.body.description || '').trim(),
        billingMode: String(req.body.billingMode || 'per_request').trim(),
        quotaPeriod: String(req.body.quotaPeriod || 'monthly').trim(),
        requestQuota: parseIntegerField(req.body.requestQuota, { fieldLabel: '请求额度', defaultValue: 0, min: 0 }),
        tokenQuota: parseIntegerField(req.body.tokenQuota, { fieldLabel: 'Token 额度', defaultValue: 0, min: 0 }),
        priorityWeight: parseIntegerField(req.body.priorityWeight, { fieldLabel: '优先级权重', defaultValue: 0, min: 0 }),
        concurrencyLimit: parseIntegerField(req.body.concurrencyLimit, { fieldLabel: '并发上限', defaultValue: 1, min: 1 }),
        maxOutputTokens: parseIntegerField(req.body.maxOutputTokens, { fieldLabel: '最大输出 Token', defaultValue: 1024, min: 1 }),
        status: String(req.body.status || 'active').trim(),
        isDefault: String(req.body.isDefault || '') === '1',
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/plans');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/plans/:planId/delete', requireAdmin, async (req, res, next) => {
    try {
      const planId = parseIdParam(req.params.planId, '套餐 ID');
      const plan = await findPlanById(planId);
      if (!plan) {
        return renderValidationMessage(res, '套餐不存在。');
      }

      try {
        await deletePlan(planId);
      } catch (error) {
        if (error.message === 'PLAN_IN_USE') {
          return renderValidationMessage(res, '这个套餐已经被订阅或历史记录引用，暂时不能删除。先解绑/更换用户套餐，再删。');
        }
        throw error;
      }

      return res.redirect('/admin/plans');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/users/:userId/role', requireAdmin, async (req, res, next) => {
    try {
      const userId = parseIdParam(req.params.userId, '用户 ID');
      const role = String(req.body.role || 'user').trim();
      if (!['user', 'admin'].includes(role)) {
        return renderValidationMessage(res, '角色类型不支持。');
      }
      await updateUserRole(userId, role);
      return res.redirect('/admin');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/users/:userId/plan', requireAdmin, async (req, res, next) => {
    try {
      const userId = parseIdParam(req.params.userId, '用户 ID');
      const planId = parseIdParam(req.body.planId, '套餐 ID');
      const plan = await findPlanById(planId);
      if (!plan) {
        return renderValidationMessage(res, '套餐不存在。');
      }
      await updateUserPlan(userId, planId);
      return res.redirect('/admin');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/providers/new', requireAdmin, async (req, res, next) => {
    try {
      const name = String(req.body.name || '').trim();
      const baseUrl = String(req.body.baseUrl || '').trim();
      const apiKey = String(req.body.apiKey || '').trim();
      if (!name || !baseUrl || !apiKey) {
        return renderValidationMessage(res, '新增 Provider 时，名称、Base URL、API Key 不能为空。模型可在保存后从 API 返回列表里搜索选择。');
      }

      await createProvider({
        name,
        baseUrl,
        apiKey,
        standardModel: String(req.body.standardModel || '').trim(),
        jailbreakModel: String(req.body.jailbreakModel || '').trim(),
        forceJailbreakModel: String(req.body.forceJailbreakModel || '').trim(),
        compressionModel: String(req.body.compressionModel || '').trim(),
        maxContextTokens: parseIntegerField(req.body.maxContextTokens, { fieldLabel: '最大上下文 Token', defaultValue: 81920, min: 1 }),
        trimContextTokens: parseIntegerField(req.body.trimContextTokens, { fieldLabel: '裁剪上下文 Token', defaultValue: 61440, min: 1 }),
        isActive: String(req.body.isActive || '') === '1',
        status: String(req.body.status || 'active').trim(),
        maxConcurrency: parseIntegerField(req.body.maxConcurrency, { fieldLabel: '最大并发数', defaultValue: 5, min: 1 }),
        timeoutMs: parseIntegerField(req.body.timeoutMs, { fieldLabel: '超时时间(ms)', defaultValue: 60000, min: 1 }),
        inputTokenPrice: parseNumberField(req.body.inputTokenPrice, { fieldLabel: '输入 Token 单价', defaultValue: 0, min: 0 }),
        outputTokenPrice: parseNumberField(req.body.outputTokenPrice, { fieldLabel: '输出 Token 单价', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/providers');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/providers/:providerId', requireAdmin, async (req, res, next) => {
    try {
      const providerId = parseIdParam(req.params.providerId, 'Provider ID');
      await updateProvider(providerId, {
        name: req.body.name,
        baseUrl: req.body.baseUrl,
        apiKey: req.body.apiKey,
        standardModel: req.body.standardModel,
        jailbreakModel: req.body.jailbreakModel,
        forceJailbreakModel: req.body.forceJailbreakModel,
        compressionModel: req.body.compressionModel,
        maxContextTokens: parseIntegerField(req.body.maxContextTokens, { fieldLabel: '最大上下文 Token', defaultValue: 81920, min: 1 }),
        trimContextTokens: parseIntegerField(req.body.trimContextTokens, { fieldLabel: '裁剪上下文 Token', defaultValue: 61440, min: 1 }),
        refreshModels: String(req.body.refreshModels || '') === '1' ? '1' : '0',
        isActive: String(req.body.isActive || '') === '1',
        status: String(req.body.status || 'active').trim(),
        maxConcurrency: parseIntegerField(req.body.maxConcurrency, { fieldLabel: '最大并发数', defaultValue: 5, min: 1 }),
        timeoutMs: parseIntegerField(req.body.timeoutMs, { fieldLabel: '超时时间(ms)', defaultValue: 60000, min: 1 }),
        inputTokenPrice: parseNumberField(req.body.inputTokenPrice, { fieldLabel: '输入 Token 单价', defaultValue: 0, min: 0 }),
        outputTokenPrice: parseNumberField(req.body.outputTokenPrice, { fieldLabel: '输出 Token 单价', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/providers');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/prompt-blocks/new', requireAdmin, async (req, res, next) => {
    try {
      const key = String(req.body.key || '').trim();
      const value = String(req.body.value || '').trim();
      if (!key || !value) {
        return renderValidationMessage(res, '提示词片段的 key 和 value 不能为空。');
      }

      await createPromptBlock({
        key,
        value,
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
        isEnabled: String(req.body.isEnabled || '1') !== '0',
      });
      return res.redirect('/admin/prompts');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/prompt-blocks/:blockId', requireAdmin, async (req, res, next) => {
    try {
      const blockId = parseIdParam(req.params.blockId, '提示词片段 ID');
      await updatePromptBlock(blockId, {
        key: req.body.key,
        value: req.body.value,
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
        isEnabled: String(req.body.isEnabled || '1') !== '0',
      });
      return res.redirect('/admin/prompts');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/prompt-blocks/reorder', requireAdmin, async (req, res, next) => {
    try {
      const blockIds = String(req.body.blockIds || '')
        .split(',')
        .map((item) => parseIntegerField(item, { fieldLabel: '提示词片段 ID', min: 1, allowEmpty: true }))
        .filter((item) => item > 0);
      await reorderPromptBlocks(blockIds);
      return res.redirect('/admin/prompts');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/prompt-blocks/:blockId/delete', requireAdmin, async (req, res, next) => {
    try {
      const blockId = parseIdParam(req.params.blockId, '提示词片段 ID');
      await deletePromptBlock(blockId);
      return res.redirect('/admin/prompts');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });
}

module.exports = { registerAdminRoutes };
