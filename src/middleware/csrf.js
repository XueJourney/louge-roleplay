/**
 * @file src/middleware/csrf.js
 * @description 基于 session 的轻量 CSRF 防护。优先校验 token；为避免上线时旧页面脚本瞬断，允许同源 Origin/Referer 兜底。
 */

'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function createCsrfToken() {
  return randomBytes(32).toString('hex');
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length || left.length === 0) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function getSubmittedToken(req) {
  return String(
    req.headers['x-csrf-token']
      || req.headers['csrf-token']
      || req.body?._csrf
      || req.query?._csrf
      || '',
  ).trim();
}

function getExpectedOrigin(req) {
  const host = req.get('host');
  if (!host) return '';
  const protocol = req.protocol || (req.secure ? 'https' : 'http');
  return `${protocol}://${host}`;
}

function isSameOrigin(req, rawUrl) {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(String(rawUrl));
    return parsed.origin === getExpectedOrigin(req);
  } catch (_) {
    return false;
  }
}

function hasSameOriginSignal(req) {
  const origin = req.get('origin');
  if (origin) {
    return isSameOrigin(req, origin);
  }
  const referer = req.get('referer');
  return isSameOrigin(req, referer);
}

function csrfProtection(req, res, next) {
  if (!req.session) {
    return next(new Error('CSRF_SESSION_UNAVAILABLE'));
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = createCsrfToken();
  }

  req.csrfToken = () => req.session.csrfToken;
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(String(req.method || '').toUpperCase())) {
    return next();
  }

  const submittedToken = getSubmittedToken(req);
  if (safeCompare(submittedToken, req.session.csrfToken) || hasSameOriginSignal(req)) {
    return next();
  }

  const error = new Error('CSRF_TOKEN_INVALID');
  error.statusCode = 403;
  return next(error);
}

module.exports = {
  csrfProtection,
};
