/**
 * @file src/routes/web/admin/provider-routes.js
 * @description 管理后台 LLM Provider 列表、新增与更新路由。
 */

const { isValidationError } = require('./admin-route-utils');

function registerAdminProviderRoutes(app, ctx) {
  const {
    requireAdmin,
    getAdminOverview,
    getLlmRuntimeQueueState,
    listProviders,
    createProvider,
    updateProvider,
    renderPage,
    renderValidationMessage,
    parseIntegerField,
    parseNumberField,
    parseIdParam,
  } = ctx;

  app.get('/admin/providers', requireAdmin, async (req, res, next) => {
    try {
      const [overview, providers] = await Promise.all([
        getAdminOverview({ runtimeQueueState: getLlmRuntimeQueueState ? getLlmRuntimeQueueState() : null }),
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
      if (isValidationError(error)) {
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
      if (isValidationError(error)) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });
}

module.exports = { registerAdminProviderRoutes };
