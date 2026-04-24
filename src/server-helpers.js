/**
 * @file src/server.js
 * @description
 * Web 应用主入口，负责中间件初始化、路由注册、会话管理与站点启动。
 *
 * 设计原则：
 * - 路由层只保留“编排逻辑”和参数校验。
 * - 结构化的消息树、分支克隆、缓存等尽量下沉到 service。
 * - DEBUG 信息统一写日志，页面只给必要状态，不暴露堆栈。
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config');
const logger = require('./lib/logger');
const { query, waitReady: waitDbReady, getDbType } = require('./lib/db');
const { initRedis, redisClient, isRedisReal } = require('./lib/redis');
const { requestContext } = require('./middleware/request-context');
const { errorHandler } = require('./middleware/error-handler');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const { hashPassword, verifyPassword } = require('./services/password-service');
const { createUser, findUserByUsername, findUserByEmail, findUserByPhone, findUserByLogin, findUserById, updateUserRole } = require('./services/user-service');
const { createCharacter, updateCharacter, listPublicCharacters, listUserCharacters, getCharacterById, deleteCharacterSafely } = require('./services/character-service');
const { listPlans, findPlanById, createPlan, updatePlan, deletePlan, getActiveSubscriptionForUser, getUserQuotaSnapshot, updateUserPlan } = require('./services/plan-service');
const { listUsersWithPlans, getAdminOverview } = require('./services/admin-service');
const { listProviders, createProvider, updateProvider } = require('./services/llm-provider-service');
const {
  listPromptBlocks,
  createPromptBlock,
  updatePromptBlock,
  reorderPromptBlocks,
  deletePromptBlock,
  parsePromptItemsFromForm,
  normalizePromptItems,
  buildPromptPreview,
} = require('./services/prompt-engineering-service');
const {
  createConversation,
  updateConversationTitle,
  updateConversationModelMode,
  getConversationById,
  listUserConversations,
  listMessages,
  getMessageById,
  addMessage,
  setConversationCurrentMessage,
  createEditedMessageVariant,
  buildPathMessages,
  buildConversationView,
  cloneConversationBranch,
  deleteMessageSafely,
  deleteConversationSafely,
  invalidateConversationCache,
} = require('./services/conversation-service');
const { generateReplyViaGateway, streamReplyViaGateway, optimizeUserInputViaGateway, getChatModelSelector } = require('./services/llm-gateway-service');
const { createCaptcha, refreshCaptcha, getCaptchaImage, verifyCaptcha } = require('./services/captcha-service');
const { issueEmailCode, issuePhoneCode, verifyEmailCode, verifyPhoneCode } = require('./services/verification-service');
const { verifyDomesticPhoneIdentity } = require('./services/phone-auth-service');
const { hitLimit } = require('./services/rate-limit-service');


function renderPage(res, view, params = {}) {
  res.render(view, params, (viewError, html) => {
    if (viewError) {
      logger.error('[renderPage] View 渲染失败', { view, error: viewError.message });
      return res.status(500).type('text').send('页面渲染失败，请稍后重试。');
    }
    res.render('layout', {
      title: params.title || config.appName,
      body: html,
      currentUser: res.locals.currentUser,
      appName: config.appName,
      appUrl: config.appUrl,
    });
  });
}

function renderRegisterPage(res, options = {}) {
  renderPage(res, 'register', {
    title: '注册',
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
  return {
    requestId: req.requestId,
    ip: getClientIp(req),
    login: String(payload.login || '').trim(),
  };
}

function renderValidationMessage(res, message, title = '提示') {
  return renderPage(res, 'message', { title, message });
}

function writeNdjson(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
  if (typeof res.flush === 'function') {
    res.flush();
  }
}

function buildChatRequestContext(req, conversation, allMessages, rawContent, parentMessageId) {
  const isFirstTurn = allMessages.length === 0;
  const content = String(rawContent || '').trim() || (isFirstTurn ? '[开始一次新的对话]' : '');
  const fallbackLeafId = conversation.current_message_id || (allMessages.length ? allMessages[allMessages.length - 1].id : null);
  const history = buildPathMessages(allMessages, parentMessageId || fallbackLeafId || null);
  const isBranchReply = parentMessageId && Number(parentMessageId) !== Number(conversation.current_message_id || 0);

  return {
    isFirstTurn,
    content,
    history,
    isBranchReply,
    promptKind: isFirstTurn ? 'conversation-start' : (isBranchReply ? 'branch' : 'chat'),
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
  return tail ? `${characterName} · ${tail}` : `${characterName} · 新分支`;
}

function buildBranchConversationTitle(conversation, branchLabel, branchSummary) {
  const compact = [branchLabel, branchSummary]
    .filter(Boolean)
    .join(' · ')
    .replace(/\s+/g, ' ')
    .slice(0, 42);
  return compact ? `${conversation.character_name} · ${compact}` : `${conversation.character_name} · 分支对话`;
}

function buildNextConversationTitle(conversation, userContent) {
  return buildConversationTitle(conversation.character_name, userContent || conversation.character_summary || '');
}

async function renderChatPage(req, res, conversation, options = {}) {
  const allMessages = await listMessages(conversation.id);
  const fallbackLeafId = conversation.current_message_id || (allMessages.length ? allMessages[allMessages.length - 1].id : null);
  const requestedLeafId = Number(options.leafId || req.query.leaf || fallbackLeafId || 0) || null;
  const activeLeafId = requestedLeafId || fallbackLeafId || null;

  if (activeLeafId && Number(conversation.current_message_id || 0) !== Number(activeLeafId)) {
    await setConversationCurrentMessage(conversation.id, activeLeafId);
    conversation.current_message_id = activeLeafId;
  }

  const view = buildConversationView(allMessages, activeLeafId);
  const chatModelSelector = await getChatModelSelector();

  renderPage(res, 'chat', {
    title: '聊天',
    conversation,
    view,
    draftContent: options.draftContent || String(req.query.draft || ''),
    optimizedContent: options.optimizedContent || '',
    regeneratedPreview: options.regeneratedPreview || null,
    chatModelSelector,
    errorMessage: options.errorMessage || null,
  });
}

async function loadConversationForUserOrFail(req, res, conversationId) {
  const conversation = await getConversationById(conversationId, req.session.user.id);
  if (!conversation) {
    renderPage(res, 'message', { title: '提示', message: '会话不存在或无权访问。' });
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
  buildBranchConversationTitle,
  buildNextConversationTitle,
  renderChatPage,
  loadConversationForUserOrFail,
};
