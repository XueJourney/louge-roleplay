/**
 * @file src/routes/web/admin/log-routes.js
 * @description 管理后台日志查询页路由，支持日期、等级、文件、错误类型和函数名筛选。
 */

const { buildPageUrl } = require('./admin-route-utils');

function registerAdminLogRoutes(app, ctx) {
  const { requireAdmin, listLogEntries, renderPage, parseIntegerField } = ctx;

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

      renderPage(res, 'admin-logs', {
        title: '日志查询',
        logResult,
        buildPageUrl: (targetPage) => buildPageUrl('/admin/logs', logResult.filters, targetPage, logResult.pageSize),
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerAdminLogRoutes };
