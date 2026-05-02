/**
 * @file src/routes/web/admin/preset-model-routes.js
 * @description Admin preset model catalog routes.
 */

const { isValidationError } = require('./admin-route-utils');

function registerAdminPresetModelRoutes(app, ctx) {
  const {
    requireAdmin,
    listProviders,
    listPresetModels,
    createPresetModel,
    updatePresetModel,
    deletePresetModel,
    renderPage,
    renderValidationMessage,
    parseIntegerField,
    parseIdParam,
  } = ctx;

  app.get('/admin/models', requireAdmin, async (req, res, next) => {
    try {
      const [overview, providers, presetModels] = await Promise.all([
        ctx.getAdminOverview(),
        listProviders(),
        listPresetModels({ includeDisabled: true }),
      ]);
      renderPage(res, 'admin-models', {
        title: '预设模型',
        overview,
        providers,
        presetModels,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/models/new', requireAdmin, async (req, res, next) => {
    try {
      await createPresetModel({
        providerId: parseIntegerField(req.body.providerId, { fieldLabel: 'Provider', defaultValue: 0, min: 1 }),
        modelId: String(req.body.modelId || '').trim(),
        modelKey: String(req.body.modelKey || '').trim(),
        name: String(req.body.name || '').trim(),
        description: String(req.body.description || '').trim(),
        status: String(req.body.status || 'active').trim(),
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/models');
    } catch (error) {
      if (isValidationError(error) || String(error.message || '').startsWith('PRESET_MODEL_')) {
        return renderValidationMessage(res, '预设模型配置无效：请确认 Provider、模型 ID、前台显示名都已填写，且不要重复添加同一 Provider 下的同一模型。');
      }
      next(error);
    }
  });

  app.post('/admin/models/:modelId', requireAdmin, async (req, res, next) => {
    try {
      const modelId = parseIdParam(req.params.modelId, '预设模型 ID');
      await updatePresetModel(modelId, {
        providerId: parseIntegerField(req.body.providerId, { fieldLabel: 'Provider', defaultValue: 0, min: 1 }),
        modelId: String(req.body.modelId || '').trim(),
        modelKey: String(req.body.modelKey || '').trim(),
        name: String(req.body.name || '').trim(),
        description: String(req.body.description || '').trim(),
        status: String(req.body.status || 'active').trim(),
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/models');
    } catch (error) {
      if (isValidationError(error) || String(error.message || '').startsWith('PRESET_MODEL_')) {
        return renderValidationMessage(res, '预设模型配置无效：请确认字段完整，且不要和已有预设重复。');
      }
      next(error);
    }
  });

  app.post('/admin/models/:modelId/delete', requireAdmin, async (req, res, next) => {
    try {
      const modelId = parseIdParam(req.params.modelId, '预设模型 ID');
      await deletePresetModel(modelId);
      return res.redirect('/admin/models');
    } catch (error) {
      if (error.message === 'PRESET_MODEL_IN_USE') {
        return renderValidationMessage(res, '这个预设模型仍被套餐引用。先从套餐中移除或替换后再删除。');
      }
      if (isValidationError(error) || String(error.message || '').startsWith('PRESET_MODEL_')) {
        return renderValidationMessage(res, '预设模型不存在或暂时不能删除。');
      }
      next(error);
    }
  });
}

module.exports = { registerAdminPresetModelRoutes };
