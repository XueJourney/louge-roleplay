/**
 * @file src/middleware/error-handler.js
 * @description 全局异常处理中间件，避免敏感堆栈直接暴露给用户。
 */

const logger = require('../lib/logger');
const config = require('../config');

/**
 * 将错误视图渲染到 layout 中，保证错误页拥有完整的导航与样式。
 * 若 layout 渲染本身失败，退化为纯文本响应，避免死循环。
 */
function renderErrorWithLayout(res, statusCode, title, message, errorCode) {
  const errorParams = { title, message, errorCode, requestId: res.locals.requestId };
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
    });
  });
}

function mapErrorToPresentation(error) {
  const message = String(error?.message || '');

  if (message === 'REQUEST_QUOTA_EXCEEDED') {
    return { statusCode: 429, title: '额度已用完', message: '请求次数额度已经用完了，先升级套餐或者等额度恢复。', errorCode: 'REQUEST_QUOTA_EXCEEDED' };
  }

  if (message === 'TOKEN_QUOTA_EXCEEDED') {
    return { statusCode: 429, title: '额度不够', message: '当前 Token 额度不足，这次请求先发不出去。', errorCode: 'TOKEN_QUOTA_EXCEEDED' };
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
  logger.error('Unhandled application error', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    error: error.message,
    stack: error.stack,
  });

  const presentation = mapErrorToPresentation(error);
  renderErrorWithLayout(res, presentation.statusCode, presentation.title, presentation.message, presentation.errorCode);
}

module.exports = {
  errorHandler,
};
