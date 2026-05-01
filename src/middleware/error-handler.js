/**
 * @file src/middleware/error-handler.js
 * @description 全局异常处理中间件，避免敏感堆栈直接暴露给用户。
 */

const logger = require('../lib/logger');
const config = require('../config');
const { translate } = require('../i18n');
const { getClientNotificationBootstrap } = require('../services/notification-service');

/**
 * 将错误视图渲染到 layout 中，保证错误页拥有完整的导航与样式。
 * 若 layout 渲染本身失败，退化为纯文本响应，避免死循环。
 */
async function renderErrorWithLayout(res, statusCode, title, message, errorCode) {
  const t = res.locals.t || ((key, vars) => translate(res.locals.locale || 'zh-CN', key, vars));
  const errorParams = { title, message, errorCode, requestId: res.locals.requestId };
  const clientNotifications = await getClientNotificationBootstrap(res.locals.currentUser || null);
  res.render('error', errorParams, (viewErr, html) => {
    if (viewErr) {
      return res.status(statusCode).type('text').send(message);
    }
    res.status(statusCode).render('layout', {
      title,
      body: html,
      currentUser: res.locals.currentUser,
      appName: config.appName,
      appUrl: config.appUrl,
      locale: res.locals.locale,
      t,
      csrfToken: res.locals.csrfToken || '',
      cspNonce: res.locals.cspNonce || '',
      clientI18nMessages: res.locals.clientI18nMessages || {},
      clientNotifications,
      localeSwitchLinks: res.locals.localeSwitchLinks || { 'zh-CN': '?lang=zh-CN', en: '?lang=en' },
    });
  });
}

function mapErrorToPresentation(error) {
  const message = String(error?.message || '');

  if (message === 'CSRF_TOKEN_INVALID') {
    return { statusCode: 403, title: '请求已过期', message: '这个操作的安全校验没有通过，请刷新页面后再试。', errorCode: 'CSRF_TOKEN_INVALID' };
  }

  if (message === 'REQUEST_QUOTA_EXCEEDED') {
    return { statusCode: 429, title: '额度已用完', message: '请求次数额度已经用完了，先升级套餐或者等额度恢复。', errorCode: 'REQUEST_QUOTA_EXCEEDED' };
  }

  if (message === 'TOKEN_QUOTA_EXCEEDED') {
    return { statusCode: 429, title: '额度不够', message: '当前 Token 额度不足，这次请求先发不出去。', errorCode: 'TOKEN_QUOTA_EXCEEDED' };
  }

  if (message === 'MODEL_NOT_AVAILABLE_FOR_PLAN') {
    return { statusCode: 403, title: '模型不可用', message: '当前套餐不支持这个模型，请切换到套餐可用模型后再试。', errorCode: 'MODEL_NOT_AVAILABLE_FOR_PLAN' };
  }

  if (message === 'User plan is not configured') {
    return { statusCode: 403, title: '套餐未配置', message: '当前账号还没有可用套餐，请联系管理员配置后再试。', errorCode: 'USER_PLAN_NOT_CONFIGURED' };
  }

  if (/rate limited|429/i.test(message)) {
    return { statusCode: 429, title: '请求太快了', message: '上游模型服务正在限流，等一会儿再试。', errorCode: 'UPSTREAM_RATE_LIMITED' };
  }

  if (/gateway timeout|request timeout|provider request timeout|504/i.test(message)) {
    return { statusCode: 504, title: '模型响应超时', message: '上游模型服务超时了，这次没生成完。稍后重试会更稳一些。', errorCode: 'UPSTREAM_TIMEOUT' };
  }

  return { statusCode: 500, title: '系统错误', message: '请求处理失败，请稍后再试。', errorCode: 'INTERNAL_SERVER_ERROR' };
}

function errorHandler(error, req, res, next) {
  const presentation = mapErrorToPresentation(error);
  const logMeta = {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    error: error.message,
    statusCode: presentation.statusCode,
  };

  if (presentation.statusCode >= 500) {
    logger.error('Unhandled application error', {
      ...logMeta,
      stack: error.stack,
    });
  } else {
    logger.warn('Handled application error', logMeta);
  }

  renderErrorWithLayout(res, presentation.statusCode, presentation.title, presentation.message, presentation.errorCode).catch(next);
}

module.exports = {
  errorHandler,
};
