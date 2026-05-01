/**
 * @file src/server-helpers.js
 * @description
 * 路由层公共辅助函数集合：页面渲染、参数解析、日志脱敏、聊天页 view model、NDJSON 流响应等。
 *
 * 调用说明：
 * - `src/routes/web-routes.js` 是主要调用方。
 * - service 层不要反向依赖本文件，避免形成“业务服务 -> 路由工具”的耦合。
 * - DEBUG 信息统一走 logger，页面只展示必要状态，不暴露内部堆栈。
 */

const config = require('./config');
const logger = require('./lib/logger');
const { translate, translateHtml } = require('./i18n');
const { parsePromptItemsFromForm, normalizePromptItems } = require('./services/prompt-engineering-service');
const {
  getConversationById,
  getLatestMessage,
  getConversationMessageCount,
  setConversationCurrentMessage,
  buildConversationPathView,
  fetchPathMessages,
} = require('./services/conversation-service');
const { getChatModelSelector } = require('./services/llm-gateway-service');
const { getClientNotificationBootstrap } = require('./services/notification-service');


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

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function maskEmail(email = '') {
  const raw = String(email || '').trim().toLowerCase();
  if (!raw || !raw.includes('@')) {
    return '';
  }
  const [localPart, domain] = raw.split('@');
  if (!localPart || !domain) {
    return '';
  }
  if (localPart.length <= 2) {
    return `${localPart[0] || '*'}***@${domain}`;
  }
  return `${localPart.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone = '') {
  const raw = String(phone || '').replace(/\s+/g, '');
  if (!raw) {
    return '';
  }
  if (raw.length <= 4) {
    return `${raw.slice(0, 1)}***`;
  }
  return `${raw.slice(0, 3)}****${raw.slice(-4)}`;
}

function buildRegisterLogMeta(req, payload = {}) {
  return {
    requestId: req.requestId,
    ip: getClientIp(req),
    username: String(payload.username || '').trim() || '',
    countryType: String(payload.countryType || '').trim() || '',
    email: maskEmail(payload.email || ''),
    phone: maskPhone(payload.phone || ''),
  };
}

function buildLoginLogMeta(req, payload = {}) {
  const login = String(payload.login || '').trim();
  return {
    requestId: req.requestId,
    ip: getClientIp(req),
    login: isEmail(login) ? maskEmail(login) : (isDomesticPhone(login) ? maskPhone(login) : login.slice(0, 3) + (login.length > 3 ? '***' : '')),
  };
}

function renderValidationMessage(res, message, title) {
  const t = res.locals.t || ((key, vars) => translate(res.locals.locale || 'zh-CN', key, vars));
  return renderPage(res, 'message', { title: title || t('提示'), message });
}

function writeNdjson(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
  if (typeof res.flush === 'function') {
    res.flush();
  }
}

async function buildChatRequestContext(req, conversation, rawContent, parentMessageId, options = {}) {
  const messageCount = options.messageCount === undefined
    ? await getConversationMessageCount(conversation.id)
    : Number(options.messageCount || 0);
  const isFirstTurn = messageCount === 0;
  const content = String(rawContent || '').trim() || (isFirstTurn ? '[开始一次新的对话]' : '');
  let fallbackLeafId = conversation.current_message_id || options.fallbackLeafId || null;
  if (!fallbackLeafId && !isFirstTurn) {
    const latestMessage = await getLatestMessage(conversation.id);
    fallbackLeafId = latestMessage?.id || null;
  }
  const history = await fetchPathMessages(conversation.id, parentMessageId || fallbackLeafId || null);
  return {
    isFirstTurn,
    content,
    history,
    promptKind: isFirstTurn ? 'conversation-start' : 'chat',
    messageCount,
  };
}

function initNdjsonStream(res) {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

function parseIntegerField(value, options = {}) {
  const {
    fieldLabel = '数值字段',
    defaultValue,
    min,
    allowEmpty = false,
  } = options;

  const raw = String(value ?? '').trim();
  if (!raw) {
    if (allowEmpty) {
      return null;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`${fieldLabel}不能为空。`);
  }

  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${fieldLabel}必须是整数。`);
  }

  const normalized = Number(raw);
  if (!Number.isSafeInteger(normalized)) {
    throw new Error(`${fieldLabel}超出允许范围。`);
  }
  if (min !== undefined && normalized < min) {
    throw new Error(`${fieldLabel}不能小于 ${min}。`);
  }
  return normalized;
}

function parseNumberField(value, options = {}) {
  const {
    fieldLabel = '数值字段',
    defaultValue,
    min,
    allowEmpty = false,
  } = options;

  const raw = String(value ?? '').trim();
  if (!raw) {
    if (allowEmpty) {
      return null;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`${fieldLabel}不能为空。`);
  }

  const normalized = Number(raw);
  if (!Number.isFinite(normalized)) {
    throw new Error(`${fieldLabel}必须是数字。`);
  }
  if (min !== undefined && normalized < min) {
    throw new Error(`${fieldLabel}不能小于 ${min}。`);
  }
  return normalized;
}

function parseIdParam(value, fieldLabel = 'ID') {
  return parseIntegerField(value, { fieldLabel, min: 1 });
}

function splitCharacterPromptProfile(promptProfileJson) {
  let items = [];

  if (Array.isArray(promptProfileJson)) {
    items = promptProfileJson;
  } else if (promptProfileJson && typeof promptProfileJson === 'object') {
    items = [promptProfileJson];
  } else {
    try {
      items = JSON.parse(promptProfileJson || '[]');
    } catch (error) {
      items = [];
    }
  }

  const structured = {
    role: '',
    traitDescription: '',
    currentScene: '',
    currentBackground: '',
  };
  const extraItems = [];

  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = String(item?.key || '').trim();
    const value = String(item?.value || '').trim();
    const isEnabled = item?.isEnabled === undefined ? true : Boolean(Number(item?.isEnabled ?? item?.is_enabled ?? 1));
    const normalized = { key, value, isEnabled, sortOrder: Number(item?.sortOrder ?? item?.sort_order ?? extraItems.length) };

    if (key === '角色') {
      structured.role = value;
      return;
    }
    if (key === '描述角色性格') {
      structured.traitDescription = value;
      return;
    }
    if (key === '当前场景') {
      structured.currentScene = value;
      return;
    }
    if (key === '当前背景') {
      structured.currentBackground = value;
      return;
    }

    if (key && key !== '角色名' && key !== '角色简介') {
      extraItems.push(normalized);
    }
  });

  return {
    structured,
    extraItems: normalizePromptItems(extraItems),
  };
}

function buildCharacterPromptProfileFromForm(body) {
  const extraItems = parsePromptItemsFromForm(body, {
    keyField: 'extraPromptItemKey',
    valueField: 'extraPromptItemValue',
    enabledField: 'extraPromptItemEnabled',
  });

  const structuredItems = [
    { key: '角色名', value: String(body.name || '').trim(), sortOrder: 0, isEnabled: true },
    { key: '角色简介', value: String(body.summary || '').trim(), sortOrder: 1, isEnabled: true },
    { key: '角色', value: String(body.role || '').trim(), sortOrder: 2, isEnabled: true },
    { key: '描述角色性格', value: String(body.traitDescription || '').trim(), sortOrder: 3, isEnabled: true },
    { key: '当前场景', value: String(body.currentScene || '').trim(), sortOrder: 4, isEnabled: true },
    { key: '当前背景', value: String(body.currentBackground || '').trim(), sortOrder: 5, isEnabled: true },
  ].filter((item) => item.value);

  return normalizePromptItems([
    ...structuredItems,
    ...extraItems.map((item, index) => ({ ...item, sortOrder: structuredItems.length + index })),
  ]);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isAllowedInternationalEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const domain = email.split('@')[1] || '';
  const allowedDomains = new Set([
    'gmail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'msn.com',
    'icloud.com',
    'me.com',
    'mac.com',
    'yahoo.com',
    'yahoo.co.jp',
    'yahoo.co.uk',
    'ymail.com',
    'aol.com',
    'proton.me',
    'protonmail.com',
  ]);
  return allowedDomains.has(domain);
}

function isDomesticPhone(value) {
  return /^1\d{10}$/.test(String(value || '').trim());
}

function buildConversationTitle(characterName, content = '') {
  const tail = String(content || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  return tail ? `${characterName} · ${tail}` : `${characterName} · 新对话`;
}

function buildNextConversationTitle(conversation, userContent) {
  return buildConversationTitle(conversation.character_name, userContent || conversation.character_summary || '');
}

async function renderChatPage(req, res, conversation, options = {}) {
  const latestMessage = conversation.current_message_id ? null : await getLatestMessage(conversation.id);
  const fallbackLeafId = conversation.current_message_id || latestMessage?.id || null;
  const requestedLeafId = Number(options.leafId || req.query.leaf || fallbackLeafId || 0) || null;
  const activeLeafId = requestedLeafId || fallbackLeafId || null;

  if (options.persistLeaf && activeLeafId && Number(conversation.current_message_id || 0) !== Number(activeLeafId)) {
    await setConversationCurrentMessage(conversation.id, activeLeafId);
    conversation.current_message_id = activeLeafId;
  }

  const view = activeLeafId
    ? await buildConversationPathView(conversation.id, activeLeafId, { messageCount: options.messageCount })
    : { pathMessages: [], activeLeafId: null, messageCount: options.messageCount === undefined ? await getConversationMessageCount(conversation.id) : Number(options.messageCount || 0) };
  const initialVisibleCount = Math.max(3, Number(options.initialVisibleCount || 3));
  const keepFromIndex = Math.max(0, view.pathMessages.length - initialVisibleCount - 1);
  view.visiblePathMessages = view.pathMessages.slice(keepFromIndex);
  view.hasOlderMessages = view.pathMessages.length > view.visiblePathMessages.length;
  view.oldestVisibleMessageId = view.visiblePathMessages.length ? view.visiblePathMessages[0].id : null;
  const chatModelSelector = await getChatModelSelector(req.session?.user?.id || null);

  const activeMode = (chatModelSelector.options || []).some((option) => option.mode === conversation.selected_model_mode)
    ? conversation.selected_model_mode
    : (chatModelSelector.options || []).find((option) => option.isDefault)?.mode || (chatModelSelector.options || [])[0]?.mode || conversation.selected_model_mode || 'standard';

  return renderPage(res, 'chat', {
    title: req.t ? req.t('聊天') : '聊天',
    conversation: {
      ...conversation,
      selected_model_mode: activeMode,
    },
    view,
    draftContent: options.draftContent || String(req.query.draft || ''),
    optimizedContent: options.optimizedContent || '',
    newContinuationPreview: options.newContinuationPreview || null,
    chatModelSelector,
    errorMessage: options.errorMessage || null,
  });
}

async function loadConversationForUserOrFail(req, res, conversationId) {
  const conversation = await getConversationById(conversationId, req.session.user.id);
  if (!conversation) {
    renderPage(res, 'message', { title: req.t ? req.t('提示') : '提示', message: req.t ? req.t('会话不存在或无权访问。') : '会话不存在或无权访问。' });
    return null;
  }
  return conversation;
}



module.exports = {
  renderPage,
  renderRegisterPage,
  getClientIp,
  maskEmail,
  maskPhone,
  buildRegisterLogMeta,
  buildLoginLogMeta,
  renderValidationMessage,
  writeNdjson,
  buildChatRequestContext,
  initNdjsonStream,
  parseIntegerField,
  parseNumberField,
  parseIdParam,
  splitCharacterPromptProfile,
  buildCharacterPromptProfileFromForm,
  isEmail,
  isAllowedInternationalEmail,
  isDomesticPhone,
  buildConversationTitle,
  buildNextConversationTitle,
  renderChatPage,
  loadConversationForUserOrFail,
};
