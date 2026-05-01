/**
 * @file src/i18n.js
 * @description 服务端/客户端共用国际化词典与翻译工具。
 * 调用说明：middleware/i18n.js 负责把 translate()/getClientMessages() 注入请求和页面。
 */

const DEFAULT_LOCALE = 'zh-CN';
const SUPPORTED_LOCALES = ['zh-CN', 'en'];

const { ZH_MESSAGES } = require('./i18n/messages.zh-CN');
const { EN_MESSAGES } = require('./i18n/messages.en');

function normalizeLocale(input, options = {}) {
  const fallback = options.fallback === undefined ? DEFAULT_LOCALE : options.fallback;
  const rawInput = String(input || '').trim();
  const raw = rawInput.toLowerCase().replace(/_/g, '-');
  if (!raw) return fallback;
  if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-hans' || raw.startsWith('zh-cn-') || raw.startsWith('zh-hans-')) return 'zh-CN';
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  return SUPPORTED_LOCALES.includes(rawInput) ? rawInput : fallback;
}

function pickFromAcceptLanguage(headerValue) {
  const parts = String(headerValue || '')
    .split(',')
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean);
  for (const part of parts) {
    const locale = normalizeLocale(part, { fallback: null });
    if (locale && SUPPORTED_LOCALES.includes(locale)) {
      return locale;
    }
  }
  return DEFAULT_LOCALE;
}

function resolveLocale(req) {
  const queryLocale = normalizeLocale(req?.query?.lang, { fallback: null });
  if (req?.query?.lang && queryLocale && SUPPORTED_LOCALES.includes(queryLocale)) {
    if (req.session) req.session.locale = queryLocale;
    return queryLocale;
  }
  const sessionLocale = normalizeLocale(req?.session?.locale, { fallback: null });
  if (req?.session?.locale && sessionLocale && SUPPORTED_LOCALES.includes(sessionLocale)) {
    return sessionLocale;
  }
  return pickFromAcceptLanguage(req?.headers?.['accept-language']);
}

function interpolate(message, vars = {}) {
  return String(message || '').replace(/\{(\w+)\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`;
  });
}

const LOCALE_HTML_PATTERNS = {
  'zh-CN': [
    [/由\s*([^\n<]+?)\s*创建/g, '由 $1 创作'],
    [/请求失败：HTTP\s*(\d+)/g, '请求失败：$1'],
    [/Provider ID #(\d+)\s*· 类型\s*([^·\n<]+)\s*· 最近更新\s*([^\n<]+)/g, '引擎 #$1 · 类型 $2 · 最近更新 $3'],
    [/剩余 Token：\s*(\d+)/g, '剩余文字额度：$1'],
    [/并发\s*(\d+)/g, '同时处理 $1'],
  ],
  en: [
    [/由\s*([^\n<]+?)\s*创建/g, 'Created by $1'],
    [/欢迎回来，\s*([^\n<]+?)\s*$/gm, 'Welcome back, $1'],
    [/创建时间：\s*([^\n<]+?)\s*$/gm, 'Created: $1'],
    [/最近更新：\s*([^\n<]+?)\s*$/gm, 'Updated: $1'],
    [/角色 #(\d+)/g, 'Character #$1'],
    [/对话 #(\d+)/g, 'Conversation #$1'],
    [/请求失败：HTTP\s*(\d+)/g, 'Request failed: $1'],
    [/Provider ID #(\d+)\s*· 类型\s*([^·\n<]+)\s*· 最近更新\s*([^\n<]+)/g, 'Engine #$1 · Type $2 · Updated $3'],
    [/当前：\s*([^\n<]+?)\s*$/gm, 'Current: $1'],
    [/状态：\s*([^·\n<]+?)\s*·/g, 'Status: $1 ·'],
    [/地区：\s*([^\n<]+?)\s*$/gm, 'Region: $1'],
    [/邮箱：\s*([^\n<]+?)\s*$/gm, 'Email: $1'],
    [/手机：\s*([^\n<]+?)\s*$/gm, 'Phone: $1'],
    [/优先级\s*(\d+)/g, 'Priority $1'],
    [/并发\s*(\d+)/g, 'Capacity $1'],
    [/消息\s*(\d+)\s*条/g, '$1 messages'],
    [/剩余请求：\s*(\d+)/g, 'Messages left: $1'],
    [/剩余 Token：\s*(\d+)/g, 'Writing allowance left: $1'],
    [/已用占比：\s*(\d+)%/g, 'Used: $1%'],
  ],
};

function getLocaleMessages(locale) {
  const normalizedLocale = normalizeLocale(locale);
  if (normalizedLocale === 'zh-CN') return ZH_MESSAGES;
  if (normalizedLocale === 'en') return EN_MESSAGES;
  return {};
}

function translate(locale, key, vars = {}) {
  const messages = getLocaleMessages(locale);
  const template = messages?.[key] || key;
  return interpolate(template, vars);
}

function translateTextSegment(locale, text) {
  const normalizedLocale = normalizeLocale(locale);
  const messages = getLocaleMessages(normalizedLocale);
  const patterns = LOCALE_HTML_PATTERNS[normalizedLocale] || [];
  if (!Object.keys(messages).length && !patterns.length) {
    return text;
  }

  let output = String(text || '');
  patterns.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });

  const exactMatch = output.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const leadingWhitespace = exactMatch ? exactMatch[1] : '';
  const coreText = exactMatch ? exactMatch[2] : output;
  const trailingWhitespace = exactMatch ? exactMatch[3] : '';

  if (coreText && Object.prototype.hasOwnProperty.call(messages, coreText) && !/\{\w+\}/.test(coreText)) {
    return `${leadingWhitespace}${messages[coreText]}${trailingWhitespace}`;
  }

  return output;
}

const TRANSLATABLE_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'aria-description', 'alt']);
const TRANSLATABLE_VALUE_TYPES = new Set(['button', 'submit', 'reset']);

function translateTagAttributes(locale, tagText) {
  const tag = String(tagText || '');
  const tagNameMatch = tag.match(/^<\/?\s*([a-z][\w:-]*)/i);
  const tagName = tagNameMatch ? tagNameMatch[1].toLowerCase() : '';
  const shouldTranslateValue = tagName === 'button' || (tagName === 'input' && (() => {
    const typeMatch = tag.match(/\btype\s*=\s*(["']?)([^"'\s>]+)\1/i);
    const type = typeMatch ? String(typeMatch[2] || '').toLowerCase() : 'text';
    return TRANSLATABLE_VALUE_TYPES.has(type);
  })());

  return tag.replace(/([:\w-]+)(\s*=\s*)(["'])([\s\S]*?)\3/g, (match, name, equals, quote, value) => {
    const attrName = String(name || '').toLowerCase();
    if (TRANSLATABLE_ATTRS.has(attrName) || (attrName === 'value' && shouldTranslateValue)) {
      return `${name}${equals}${quote}${translateTextSegment(locale, value)}${quote}`;
    }
    return match;
  });
}

function translateHtml(locale, html) {
  const source = String(html || '');
  const parts = source.split(/(<[^>]+>)/g);
  let blockedDepth = 0;

  return parts.map((part) => {
    if (!part) return part;
    if (part.startsWith('<')) {
      const isClosingBlocked = /^<\/\s*(script|style|textarea)\b/i.test(part);
      const isOpeningBlocked = /^<\s*(script|style|textarea)\b/i.test(part) && !/\/>$/.test(part);
      const translatedTag = blockedDepth > 0 ? part : translateTagAttributes(locale, part);
      if (isClosingBlocked && blockedDepth > 0) blockedDepth -= 1;
      if (isOpeningBlocked) blockedDepth += 1;
      return translatedTag;
    }
    return blockedDepth > 0 ? part : translateTextSegment(locale, part);
  }).join('');
}

function getClientMessages(locale) {
  return getLocaleMessages(locale);
}

function buildLocaleSwitchLinks(req) {
  const originalUrl = String(req?.originalUrl || req?.url || '/');
  const url = new URL(originalUrl, 'http://localhost');
  const links = {};
  SUPPORTED_LOCALES.forEach((locale) => {
    url.searchParams.set('lang', locale);
    links[locale] = `${url.pathname}${url.search}`;
  });
  return links;
}

module.exports = {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  resolveLocale,
  translate,
  getClientMessages,
  buildLocaleSwitchLinks,
  translateHtml,
};
