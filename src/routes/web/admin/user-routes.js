/**
 * @file src/routes/web/admin/user-routes.js
 * @description 管理后台用户角色与套餐调整路由。
 */

const { isValidationError } = require('./admin-route-utils');

function registerAdminUserRoutes(app, ctx) {
  const {
    requireAdmin,
    updateUserRole,
    findPlanById,
    updateUserPlan,
    renderValidationMessage,
    parseIdParam,
  } = ctx;

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
      if (isValidationError(error)) {
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
      if (isValidationError(error)) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });
}

module.exports = { registerAdminUserRoutes };
