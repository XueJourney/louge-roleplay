/**
 * @file src/routes/web-routes.js
 * @description 站点路由注册：公开页、认证、角色、线性聊天、重写与编辑。
 */

const path = require('path');
const ejs = require('ejs');

const {
  requireAuth,
  requireAdmin,
} = require('../middleware/auth');

const {
  createCaptcha,
  refreshCaptcha,
  getCaptchaImage,
  verifyCaptcha,
} = require('../services/captcha-service');
const { createUser, findUserByUsername, findUserByEmail, findUserByPhone, findUserByLogin, findUserById, findUserAuthById, updateUserRole, updateUsername, updatePasswordHash, updateUserEmail, unbindUserEmail, updateUserPhone, unbindUserPhone } = require('../services/user-service');
const { createCharacter, updateCharacter, listPublicCharacters, listFeaturedPublicCharacters, listUserCharacters, getCharacterById, deleteCharacterSafely } = require('../services/character-service');
const { toggleCharacterLike, addCharacterComment, listCharacterComments, markCharacterUsed } = require('../services/character-social-service');
const { listPlans, findPlanById, createPlan, updatePlan, deletePlan, getActiveSubscriptionForUser, getUserQuotaSnapshot, updateUserPlan } = require('../services/plan-service');
const { listUsersWithPlans, getAdminOverview } = require('../services/admin-service');
const { listLogEntries } = require('../services/log-service');
const { DEFAULT_SUPPORT_QR_URL, listNotificationsForAdmin, listActiveNotificationsForUser, createNotification, updateNotification, deleteNotification } = require('../services/notification-service');
const { getAdminConversationDetail, listAdminConversations, permanentlyDeleteConversation, permanentlyDeleteMessage, restoreConversation, restoreMessage } = require('../services/admin-conversation-service');
const { listProviders, createProvider, updateProvider } = require('../services/llm-provider-service');
const {
  listPromptBlocks,
  createPromptBlock,
  updatePromptBlock,
  reorderPromptBlocks,
  deletePromptBlock,
  parsePromptItemsFromForm,
  normalizePromptItems,
  buildPromptPreview,
  applyRuntimeTemplate,
} = require('../services/prompt-engineering-service');
const {
  createConversation,
  updateConversationTitle,
  updateConversationModelMode,
  getConversationById,
  listUserConversations,
  getMessageById,
  getLatestMessage,
  addMessage,
  createEditedMessageVariant,
  fetchPathMessages,
  buildConversationPathView,
  cloneConversationBranch,
  deleteMessageSafely,
  deleteConversationSafely,
  invalidateConversationCache,
} = require('../services/conversation-service');
const { translate, translateHtml } = require('../i18n');
const { generateReplyViaGateway, streamReplyViaGateway, streamOptimizeUserInputViaGateway, optimizeUserInputViaGateway, getChatModelSelector } = require('../services/llm-gateway-service');
const { issueEmailCode, issuePhoneCode, verifyEmailCode, verifyPhoneCode } = require('../services/verification-service');
const { hashPassword, verifyPassword } = require('../services/password-service');
const { verifyDomesticPhoneIdentity } = require('../services/phone-auth-service');
const { hitLimit } = require('../services/rate-limit-service');
const { CSS_CACHE_TTL_MS, FONT_CACHE_TTL_MS, getGoogleFontCss, getFontFile, logFontProxyError } = require('../services/font-proxy-service');
const logger = require('../lib/logger');
const config = require('../config');
const { query, getDbType } = require('../lib/db');
const { redisClient, isRedisReal } = require('../lib/redis');

const {
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
} = require('../server-helpers');

function mapLlmErrorToUserMessage(error) {
  const errMsg = String(error?.message || '');
  if (errMsg === 'REQUEST_QUOTA_EXCEEDED' || errMsg === 'TOKEN_QUOTA_EXCEEDED') {
    return '额度不足，暂时没法继续生成。';
  }
  if (/aborted by downstream client/i.test(errMsg)) {
    return '这次生成已中断。';
  }
  if (/gateway timeout|request timeout|provider request timeout|504/i.test(errMsg)) {
    return '上游模型服务超时了，先歇一下再试。';
  }
  if (/rate limited|429/i.test(errMsg)) {
    return '上游模型服务被限流了，等一会儿再试。';
  }
  return 'AI 回复失败，请稍后重试。';
}

function buildConversationCharacterPayload(conversation) {
  return {
    name: conversation.character_name,
    summary: conversation.character_summary,
    personality: conversation.personality,
    prompt_profile_json: conversation.prompt_profile_json,
  };
}

const CHAT_MESSAGE_PARTIAL = path.join(__dirname, '..', 'views', 'partials', 'chat-message.ejs');

function renderChatMessageHtml(req, conversation, message) {
  const locale = req.locale || req.res?.locals?.locale || 'zh-CN';
  const t = req.t || req.res?.locals?.t || ((key, vars) => translate(locale, key, vars));

  return new Promise((resolve, reject) => {
    ejs.renderFile(CHAT_MESSAGE_PARTIAL, { conversation, message, t, locale }, {}, (error, html) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(translateHtml(locale, html));
    });
  });
}

async function buildChatMessagePacket(req, conversation, activeLeafId, messageId) {
  const view = await buildConversationPathView(conversation.id, activeLeafId || messageId);
  const message = view.pathMessages.find((item) => Number(item.id) === Number(messageId));
  if (!message) {
    return null;
  }
  return {
    id: message.id,
    senderType: message.sender_type,
    html: await renderChatMessageHtml(req, conversation, message),
  };
}

function createNdjsonResponder(req, res) {
  let streamClosed = false;
  const abortController = new AbortController();

  initNdjsonStream(res);

  const safeWrite = (payload) => {
    if (streamClosed || res.writableEnded) {
      return false;
    }
    writeNdjson(res, payload);
    if (typeof res.flush === 'function') {
      res.flush();
    }
    return true;
  };

  const heartbeatTimer = setInterval(() => {
    safeWrite({ type: 'ping', ts: Date.now() });
  }, 10000);

  const cleanup = () => {
    if (streamClosed) {
      return;
    }
    streamClosed = true;
    clearInterval(heartbeatTimer);
  };

  req.on('close', () => {
    if (res.writableEnded) {
      cleanup();
      return;
    }
    cleanup();
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  });

  return {
    abortController,
    safeWrite,
    isClosed: () => streamClosed || res.writableEnded,
    end: () => {
      cleanup();
      if (!res.writableEnded) {
        res.end();
      }
    },
    fail: (error) => {
      if (!res.writableEnded) {
        safeWrite({
          type: 'error',
          message: mapLlmErrorToUserMessage(error),
        });
        res.end();
      }
      cleanup();
    },
  };
}

async function streamChatReplyToNdjson({
  requestId,
  userId,
  conversationId,
  character,
  messages,
  userMessage,
  systemHint = '',
  promptKind = 'chat',
  modelMode = 'standard',
  signal,
  safeWrite,
  user = null,
}) {
  let lineBuffer = '';
  let latestFullContent = '';
  let streamed;
  try {
    streamed = await streamReplyViaGateway({
      requestId,
      userId,
      conversationId,
      character,
      messages,
      userMessage,
      systemHint,
      promptKind,
      modelMode,
      signal,
      user,
      onDelta: async (deltaText, fullContent) => {
        latestFullContent = String(fullContent || '');
        safeWrite({ type: 'delta', delta: deltaText, full: fullContent });
        lineBuffer += deltaText;
        const parts = lineBuffer.split(/\r?\n/);
        lineBuffer = parts.pop() || '';
        const committedText = fullContent.slice(0, Math.max(0, fullContent.length - lineBuffer.length));
        parts.forEach((line) => {
          safeWrite({
            type: 'line',
            line,
            full: fullContent,
            committed: committedText,
            tail: lineBuffer,
          });
        });
      },
    });
  } catch (error) {
    if (signal && signal.aborted && latestFullContent.trim()) {
      return latestFullContent;
    }
    throw error;
  }

  if (lineBuffer.trim()) {
    safeWrite({
      type: 'line',
      line: lineBuffer,
      full: streamed.content,
      committed: streamed.content,
      tail: '',
    });
  }

  return streamed.content;
}

async function streamOptimizedInputToNdjson({
  requestId,
  userId,
  conversationId,
  character,
  messages,
  userInput,
  modelMode = 'standard',
  signal,
  safeWrite,
  user = null,
}) {
  let lineBuffer = '';
  const streamed = await streamOptimizeUserInputViaGateway({
    requestId,
    userId,
    conversationId,
    character,
    messages,
    userInput,
    modelMode,
    signal,
    user,
    onDelta: async (deltaText, fullContent) => {
      safeWrite({ type: 'delta', delta: deltaText, full: fullContent });
      lineBuffer += deltaText;
      const parts = lineBuffer.split(/\r?\n/);
      lineBuffer = parts.pop() || '';
      const committedText = fullContent.slice(0, Math.max(0, fullContent.length - lineBuffer.length));
      parts.forEach((line) => {
        safeWrite({
          type: 'line',
          line,
          full: fullContent,
          committed: committedText,
          tail: lineBuffer,
        });
      });
    },
  });

  if (lineBuffer.trim()) {
    safeWrite({
      type: 'line',
      line: lineBuffer,
      full: streamed.content,
      committed: streamed.content,
      tail: '',
    });
  }

  return streamed.content;
}

const { registerPublicRoutes } = require('./web/public-routes');
const { registerAuthRoutes } = require('./web/auth-routes');
const { registerAdminRoutes } = require('./web/admin-routes');
const { registerCharacterRoutes } = require('./web/character-routes');
const { registerChatRoutes } = require('./web/chat-routes');

function registerWebRoutes(app) {
  logger.debug('Registering web routes', {
    routeGroups: ['fonts', 'public', 'auth', 'profile', 'admin', 'characters', 'chat'],
  });

  const routeContext = {
    requireAuth,
    requireAdmin,
    createCaptcha,
    refreshCaptcha,
    getCaptchaImage,
    verifyCaptcha,
    createUser,
    findUserByUsername,
    findUserByEmail,
    findUserByPhone,
    findUserByLogin,
    findUserById,
    findUserAuthById,
    updateUserRole,
    updateUsername,
    updatePasswordHash,
    updateUserEmail,
    unbindUserEmail,
    updateUserPhone,
    unbindUserPhone,
    createCharacter,
    updateCharacter,
    listPublicCharacters,
    listFeaturedPublicCharacters,
    toggleCharacterLike,
    addCharacterComment,
    listCharacterComments,
    markCharacterUsed,
    listUserCharacters,
    getCharacterById,
    deleteCharacterSafely,
    listPlans,
    findPlanById,
    createPlan,
    updatePlan,
    deletePlan,
    getActiveSubscriptionForUser,
    getUserQuotaSnapshot,
    updateUserPlan,
    listUsersWithPlans,
    getAdminOverview,
    listLogEntries,
    DEFAULT_SUPPORT_QR_URL,
    listNotificationsForAdmin,
    listActiveNotificationsForUser,
    createNotification,
    updateNotification,
    deleteNotification,
    getAdminConversationDetail,
    listAdminConversations,
    permanentlyDeleteConversation,
    permanentlyDeleteMessage,
    restoreConversation,
    restoreMessage,
    listProviders,
    createProvider,
    updateProvider,
    listPromptBlocks,
    createPromptBlock,
    updatePromptBlock,
    reorderPromptBlocks,
    deletePromptBlock,
    parsePromptItemsFromForm,
    normalizePromptItems,
    buildPromptPreview,
    applyRuntimeTemplate,
    createConversation,
    updateConversationTitle,
    updateConversationModelMode,
    getConversationById,
    listUserConversations,
    getMessageById,
    getLatestMessage,
    addMessage,
    createEditedMessageVariant,
    fetchPathMessages,
    buildConversationPathView,
    cloneConversationBranch,
    deleteMessageSafely,
    deleteConversationSafely,
    invalidateConversationCache,
    translate,
    translateHtml,
    generateReplyViaGateway,
    streamReplyViaGateway,
    streamOptimizeUserInputViaGateway,
    optimizeUserInputViaGateway,
    getChatModelSelector,
    issueEmailCode,
    issuePhoneCode,
    verifyEmailCode,
    verifyPhoneCode,
    hashPassword,
    verifyPassword,
    verifyDomesticPhoneIdentity,
    hitLimit,
    CSS_CACHE_TTL_MS,
    FONT_CACHE_TTL_MS,
    getGoogleFontCss,
    getFontFile,
    logFontProxyError,
    logger,
    config,
    query,
    getDbType,
    redisClient,
    isRedisReal,
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
    mapLlmErrorToUserMessage,
    buildConversationCharacterPayload,
    renderChatMessageHtml,
    buildChatMessagePacket,
    createNdjsonResponder,
    streamChatReplyToNdjson,
    streamOptimizedInputToNdjson
  };

  registerPublicRoutes(app, routeContext);
  registerAuthRoutes(app, routeContext);
  registerAdminRoutes(app, routeContext);
  registerCharacterRoutes(app, routeContext);
  registerChatRoutes(app, routeContext);
}

module.exports = { registerWebRoutes };
