/**
 * @file src/server-helpers/rendering.js
 * @description EJS 页面渲染、默认 meta 与通用提示页封装。
 */

const config = require('../config');
const logger = require('../lib/logger');
const { translate, translateHtml } = require('../i18n');
const { getClientNotificationBootstrap } = require('../services/notification-service');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAbsoluteUrl(pathOrUrl) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) {
    return config.appUrl;
  }
  try {
    return new URL(raw, config.appUrl).toString();
  } catch (_) {
    return raw;
  }
}

function buildDefaultMeta(params = {}) {
  const defaultDescription = translate(params.locale || 'zh-CN', '楼阁默认分享描述');
  const description = String(params.description || defaultDescription).trim();
  const image = buildAbsoluteUrl(params.image || '/public/icons/og-louge.png');
  const url = buildAbsoluteUrl(params.url || '/');

  return {
    description,
    image,
    url,
    type: params.type || 'website',
    siteName: config.appName,
    twitterCard: params.twitterCard || 'summary_large_image',
  };
}

async function renderPage(res, view, params = {}) {
  const locale = res.locals.locale || 'zh-CN';
  const t = res.locals.t || ((key, vars) => translate(locale, key, vars));
  const titleSource = params.title || config.appName;
  const title = translateHtml(locale, t(titleSource));
  const meta = buildDefaultMeta({
    ...params.meta,
    locale,
    title,
  });
  const clientNotifications = await getClientNotificationBootstrap(res.locals.currentUser || null);
  return new Promise((resolve) => {
    res.render(view, params, (viewError, html) => {
      if (viewError) {
        logger.error('[renderPage] View 渲染失败', { view, error: viewError.message });
        res.status(500).type('text').send(t('页面渲染失败，请稍后重试。'));
        resolve();
        return;
      }
      const translatedHtml = translateHtml(locale, html);
      res.render('layout', {
        title,
        body: translatedHtml,
        currentUser: res.locals.currentUser,
        appName: config.appName,
        appUrl: config.appUrl,
        meta,
        escapeHtml,
        locale,
        t,
        csrfToken: res.locals.csrfToken || '',
        cspNonce: res.locals.cspNonce || '',
        clientI18nMessages: res.locals.clientI18nMessages || {},
        clientNotifications,
        localeSwitchLinks: res.locals.localeSwitchLinks || { 'zh-CN': '?lang=zh-CN', en: '?lang=en' },
      });
      resolve();
    });
  });
}

function renderRegisterPage(res, options = {}) {
  const t = res.locals.t || ((key, vars) => translate(res.locals.locale || 'zh-CN', key, vars));
  renderPage(res, 'register', {
    title: t('注册'),
    captcha: options.captcha,
    form: options.form || {},
    formMessage: options.formMessage || '',
    authConfig: config.publicPhoneAuthConfig,
  });
}

function renderValidationMessage(res, message, title) {
  const t = res.locals.t || ((key, vars) => translate(res.locals.locale || 'zh-CN', key, vars));
  return renderPage(res, 'message', { title: title || t('提示'), message });
}

module.exports = {
  escapeHtml,
  buildAbsoluteUrl,
  buildDefaultMeta,
  renderPage,
  renderRegisterPage,
  renderValidationMessage,
};
