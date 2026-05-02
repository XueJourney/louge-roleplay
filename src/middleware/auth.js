/**
 * @file src/middleware/auth.js
 * @description 登录鉴权与管理员权限中间件。
 */

const logger = require('../lib/logger');
const config = require('../config');
const { translate } = require('../i18n');
const { findUserById, normalizeReplyLengthPreference } = require('../services/user-service');

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  const user = await findUserById(req.session.user.id);
  if (!user || String(user.status || 'active') !== 'active') {
    req.session.destroy(() => res.redirect('/login'));
    return undefined;
  }
  req.session.user = { ...req.session.user, username: user.username, role: user.role || 'user', status: user.status || 'active', show_nsfw: Number(user.show_nsfw || 0), reply_length_preference: normalizeReplyLengthPreference(user.reply_length_preference) };
  res.locals.currentUser = req.session.user;
  return next();
}

async function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  const user = await findUserById(req.session.user.id);
  if (!user || String(user.status || 'active') !== 'active') {
    req.session.destroy(() => res.redirect('/login'));
    return undefined;
  }
  req.session.user = { ...req.session.user, username: user.username, role: user.role || 'user', status: user.status || 'active', show_nsfw: Number(user.show_nsfw || 0), reply_length_preference: normalizeReplyLengthPreference(user.reply_length_preference) };
  res.locals.currentUser = req.session.user;
  if (req.session.user.role !== 'admin') {
    logger.warn('Forbidden admin access attempt', {
      requestId: req.requestId,
      userId: req.session.user.id,
      role: req.session.user.role,
      path: req.path,
    });
    const t = req.t || ((key, vars) => translate(res.locals.locale || 'zh-CN', key, vars));
    const errorParams = {
      title: t('权限不足'),
      message: t('这里只有管理员能进。'),
      errorCode: 'FORBIDDEN',
      requestId: req.requestId,
    };
    return res.render('error', errorParams, (viewErr, html) => {
      if (viewErr) {
        return res.status(403).type('text').send(t('权限不足'));
      }
      res.status(403).render('layout', {
        title: t('权限不足'),
        body: html,
        currentUser: res.locals.currentUser,
        appName: config.appName,
        appUrl: config.appUrl,
        locale: res.locals.locale,
        t,
        csrfToken: res.locals.csrfToken || '',
        cspNonce: res.locals.cspNonce || '',
        clientI18nMessages: res.locals.clientI18nMessages || {},
        clientNotifications: [],
        unreadSiteMessageCount: 0,
        meta: {},
        escapeHtml: (value) => String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;'),
        localeSwitchLinks: res.locals.localeSwitchLinks || { 'zh-TW': '?lang=zh-TW', 'zh-CN': '?lang=zh-CN', en: '?lang=en' },
      });
    });
  }
  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
};

