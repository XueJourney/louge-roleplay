/**
 * @file src/middleware/request-context.js
 * @description 为每个请求注入 requestId 与基础调试信息，方便日志追踪。
 */

const { randomUUID, randomBytes } = require('node:crypto');

function requestContext(req, res, next) {
  req.requestId = randomUUID();
  res.locals.requestId = req.requestId;
  res.locals.currentUser = req.session ? req.session.user : null;
  res.locals.cspNonce = randomBytes(16).toString('base64');
  next();
}

module.exports = {
  requestContext,
};
