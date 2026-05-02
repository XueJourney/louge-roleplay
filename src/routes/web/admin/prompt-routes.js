/**
 * @file src/routes/web/admin/prompt-routes.js
 * @description 管理后台全局 Prompt 片段预览、创建、排序、更新与删除路由。
 */

const { isValidationError } = require('./admin-route-utils');

function registerAdminPromptRoutes(app, ctx) {
  const {
    requireAdmin,
    getAdminOverview,
    listPromptBlocks,
    createPromptBlock,
    updatePromptBlock,
    reorderPromptBlocks,
    deletePromptBlock,
    buildPromptPreview,
    renderPage,
    renderValidationMessage,
    parseIntegerField,
    parseIdParam,
  } = ctx;

  app.get('/admin/prompts', requireAdmin, async (req, res, next) => {
    try {
      const [overview, promptBlocks] = await Promise.all([
        getAdminOverview(),
        listPromptBlocks(),
      ]);
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
        overview,
        promptBlocks,
        promptPreview,
        promptPreviewMeta,
      });
    } catch (error) {
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
      if (isValidationError(error)) {
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
      if (isValidationError(error)) {
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
      if (isValidationError(error)) {
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
      if (isValidationError(error)) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });
}

module.exports = { registerAdminPromptRoutes };
