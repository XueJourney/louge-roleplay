/**
 * @file src/routes/web/admin/plan-routes.js
 * @description 管理后台套餐列表、新增、更新与删除路由，包含模型权益配置校验。
 */

const { isValidationError } = require('./admin-route-utils');

function registerAdminPlanRoutes(app, ctx) {
  const {
    requireAdmin,
    listPlans,
    findPlanById,
    createPlan,
    updatePlan,
    deletePlan,
    getAdminOverview,
    listProviders,
    renderPage,
    renderValidationMessage,
    parsePlanModelsFromBody,
    validatePlanModelsAgainstProviders,
    parseIntegerField,
    parseIdParam,
  } = ctx;

  app.get('/admin/plans', requireAdmin, async (req, res, next) => {
    try {
      const [overview, plans, providers] = await Promise.all([
        getAdminOverview(),
        listPlans(),
        listProviders(),
      ]);

      renderPage(res, 'admin-plans', {
        title: '套餐配置',
        overview,
        plans,
        providers,
      });
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

      const planModels = parsePlanModelsFromBody(req.body);
      if (!planModels.length) {
        return renderValidationMessage(res, '每个套餐至少要配置一个可用模型。');
      }
      try {
        await validatePlanModelsAgainstProviders(planModels);
      } catch (error) {
        return renderValidationMessage(res, '套餐模型配置无效：请确认已配置 Provider，并且每行模型都来自所选 Provider。');
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
        planModels,
        status: String(req.body.status || 'active').trim(),
        isDefault: String(req.body.isDefault || '') === '1',
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/plans');
    } catch (error) {
      if (isValidationError(error)) {
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

      const planModels = parsePlanModelsFromBody(req.body);
      if (!planModels.length) {
        return renderValidationMessage(res, '每个套餐至少要配置一个可用模型。');
      }
      try {
        await validatePlanModelsAgainstProviders(planModels);
      } catch (error) {
        return renderValidationMessage(res, '套餐模型配置无效：请确认已配置 Provider，并且每行模型都来自所选 Provider。');
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
        planModels,
        status: String(req.body.status || 'active').trim(),
        isDefault: String(req.body.isDefault || '') === '1',
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/plans');
    } catch (error) {
      if (isValidationError(error)) {
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
      if (isValidationError(error)) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });
}

module.exports = { registerAdminPlanRoutes };
