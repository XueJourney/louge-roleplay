/**
 * @file src/routes/web-routes.js
 * @description 站点路由注册：公开页、认证、角色、线性聊天、重写与编辑。
 */

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
const { parsePlanModelsFromBody } = require('../services/model-form-service');
const { validatePlanModelsAgainstProviders } = require('../services/plan-model-validation-service');
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
const { translate } = require('../i18n');
const { DEFAULT_MODEL_KEY, normalizeModelKey } = require('../services/model-entitlement-service');
const { generateReplyViaGateway, optimizeUserInputViaGateway, getChatModelSelector } = require('../services/llm-gateway-service');
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
  buildChatRequestContext,
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
const {
  mapLlmErrorToUserMessage,
  buildConversationCharacterPayload,
  renderChatMessageHtml,
  buildChatMessagePacket,
  createNdjsonResponder,
  streamChatReplyToNdjson,
  streamOptimizedInputToNdjson,
} = require('./web/chat-stream-utils');

async function resolveAllowedInitialModelMode(userId, requestedModelMode = '') {
  try {
    const selector = await getChatModelSelector(userId);
    const options = selector.options || [];
    if (!options.length) {
      return normalizeModelKey(requestedModelMode, DEFAULT_MODEL_KEY);
    }
    const requested = normalizeModelKey(requestedModelMode, '');
    const matched = options.find((option) => option.mode === requested);
    return matched?.mode || options.find((option) => option.isDefault)?.mode || options[0].mode || DEFAULT_MODEL_KEY;
  } catch (_) {
    return DEFAULT_MODEL_KEY;
  }
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
    generateReplyViaGateway,
    optimizeUserInputViaGateway,
    getChatModelSelector,
    DEFAULT_MODEL_KEY,
    normalizeModelKey,
    parsePlanModelsFromBody,
    validatePlanModelsAgainstProviders,
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
    buildChatRequestContext,
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
    resolveAllowedInitialModelMode,
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
