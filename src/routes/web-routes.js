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
const { createUser, findUserByUsername, findUserByEmail, findUserByPhone, findUserByLogin, findUserById, findUserAuthById, updateUserRole, updateUserStatus, updateUsername, updatePasswordHash, updateUserEmail, unbindUserEmail, updateUserPhone, unbindUserPhone, updateUserNsfwPreference, updateUserReplyLengthPreference } = require('../services/user-service');
const { createCharacter, updateCharacter, listPublicCharacters, listFeaturedPublicCharacters, getPublicCharacterDetail, listUserCharacters, getCharacterById, deleteCharacterSafely, ensureCharacterImageColumns } = require('../services/character-service');
const { toggleCharacterLike, addCharacterComment, listCharacterComments, markCharacterUsed } = require('../services/character-social-service');
const { listPlans, findPlanById, createPlan, updatePlan, deletePlan, getActiveSubscriptionForUser, getUserQuotaSnapshot, updateUserPlan } = require('../services/plan-service');
const { listUsersWithPlans, getAdminOverview, safelyDeleteUserById } = require('../services/admin-service');
const { listLogEntries } = require('../services/log-service');
const { DEFAULT_SUPPORT_QR_URL, listNotificationsForAdmin, listActiveNotificationsForUser, createNotification, updateNotification, deleteNotification } = require('../services/notification-service');
const { createSiteMessage, listSiteMessagesForAdmin, listInboxMessagesForUser, getUnreadSiteMessageCount, markSiteMessageRead, markAllSiteMessagesRead, getSiteMessageRealtimeSnapshot } = require('../services/site-message-service');
const { deleteAdminCharacter, ensureCharactersStatusEnumSupportsBlocked, getAdminCharacterDetail, getAdminCharacterById, listAdminCharacters, updateAdminCharacterStatus } = require('../services/admin-character-service');
const { listPublicTags, listAllTags } = require('../services/character-tag-service');
const { uploadTavernCards, previewTavernImport, saveImportPreview, loadImportPreview, deleteImportPreview, importPreviewExists, buildConfirmItemsFromPreview, confirmTavernImport, listImportBatches } = require('../services/tavern-card-import-service');
const { getAdminConversationDetail, listAdminConversations, permanentlyDeleteConversation, permanentlyDeleteMessage, restoreConversation, restoreMessage } = require('../services/admin-conversation-service');
const { listProviders, createProvider, updateProvider } = require('../services/llm-provider-service');
const { listPresetModels, createPresetModel, updatePresetModel, deletePresetModel } = require('../services/preset-model-service');
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
const { DEFAULT_MODEL_KEY, normalizeModelKey, findPlanModel } = require('../services/model-entitlement-service');
const { generateReplyViaGateway, optimizeUserInputViaGateway, getChatModelSelector, getLlmRuntimeQueueState } = require('../services/llm-gateway-service');
const { issueEmailCode, issuePhoneCode, verifyEmailCode, verifyPhoneCode } = require('../services/verification-service');
const { hashPassword, verifyPassword } = require('../services/password-service');
const { verifyDomesticPhoneIdentity } = require('../services/phone-auth-service');
const { hitLimit } = require('../services/rate-limit-service');
const { CSS_CACHE_TTL_MS, FONT_CACHE_TTL_MS, getGoogleFontCss, getFontFile, logFontProxyError } = require('../services/font-proxy-service');
const { uploadCharacterImages, getUploadedCharacterImagePaths, cleanupUploadedCharacterFiles, deleteStoredImageIfOwned } = require('../services/upload-service');
const logger = require('../lib/logger');
const config = require('../config');
const { query, getDbType } = require('../lib/db');
const { redisClient, isRedisReal } = require('../lib/redis');
const { clampCharacterField } = require('../constants/character-limits');

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
    if (matched) {
      return matched.mode;
    }
    const fallbackModel = findPlanModel(options.map((option) => ({
      modelKey: option.mode,
      label: option.label,
      description: option.description,
      providerId: option.providerId,
      modelId: option.hiddenModelId,
      requestMultiplier: option.requestMultiplier,
      tokenMultiplier: option.tokenMultiplier,
      isDefault: option.isDefault,
    })), requested || DEFAULT_MODEL_KEY);
    return fallbackModel?.modelKey || options.find((option) => option.isDefault)?.mode || options[0].mode || DEFAULT_MODEL_KEY;
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
    updateUserStatus,
    updateUsername,
    updatePasswordHash,
    updateUserEmail,
    unbindUserEmail,
    updateUserPhone,
    unbindUserPhone,
    updateUserNsfwPreference,
    updateUserReplyLengthPreference,
    ensureCharacterImageColumns,
    createCharacter,
    updateCharacter,
    listPublicCharacters,
    listFeaturedPublicCharacters,
    getPublicCharacterDetail,
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
    safelyDeleteUserById,
    listLogEntries,
    DEFAULT_SUPPORT_QR_URL,
    listNotificationsForAdmin,
    listActiveNotificationsForUser,
    createNotification,
    updateNotification,
    deleteNotification,
    createSiteMessage,
    listSiteMessagesForAdmin,
    listInboxMessagesForUser,
    getUnreadSiteMessageCount,
    markSiteMessageRead,
    markAllSiteMessagesRead,
    getSiteMessageRealtimeSnapshot,
    deleteAdminCharacter,
    ensureCharactersStatusEnumSupportsBlocked,
    getAdminCharacterDetail,
    getAdminCharacterById,
    listAdminCharacters,
    updateAdminCharacterStatus,
    listPublicTags,
    listAllTags,
    uploadTavernCards,
    previewTavernImport,
    saveImportPreview,
    loadImportPreview,
    deleteImportPreview,
    importPreviewExists,
    buildConfirmItemsFromPreview,
    confirmTavernImport,
    listImportBatches,
    getAdminConversationDetail,
    listAdminConversations,
    permanentlyDeleteConversation,
    permanentlyDeleteMessage,
    restoreConversation,
    restoreMessage,
    listProviders,
    createProvider,
    updateProvider,
    listPresetModels,
    createPresetModel,
    updatePresetModel,
    deletePresetModel,
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
    getLlmRuntimeQueueState,
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
    uploadCharacterImages,
    getUploadedCharacterImagePaths,
    cleanupUploadedCharacterFiles,
    deleteStoredImageIfOwned,
    logger,
    config,
    query,
    getDbType,
    redisClient,
    isRedisReal,
    clampCharacterField,
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
