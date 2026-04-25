/**
 * @file src/routes/web-routes.js
 * @description 站点路由注册：公开页、认证、角色、聊天、分支与回放。
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
const { createUser, findUserByUsername, findUserByEmail, findUserByPhone, findUserByLogin, findUserById, findUserAuthById, updateUserRole, updateUsername, updatePasswordHash } = require('../services/user-service');
const { createCharacter, updateCharacter, listPublicCharacters, listUserCharacters, getCharacterById, deleteCharacterSafely } = require('../services/character-service');
const { listPlans, findPlanById, createPlan, updatePlan, deletePlan, getActiveSubscriptionForUser, getUserQuotaSnapshot, updateUserPlan } = require('../services/plan-service');
const { listUsersWithPlans, getAdminOverview } = require('../services/admin-service');
const { listLogEntries } = require('../services/log-service');
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
} = require('../services/conversation-service');
const { translateHtml } = require('../i18n');
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
  buildBranchConversationTitle,
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
  return new Promise((resolve, reject) => {
    ejs.renderFile(CHAT_MESSAGE_PARTIAL, { conversation, message }, {}, (error, html) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(translateHtml(req.locale || 'zh-CN', html));
    });
  });
}

async function buildChatMessagePacket(req, conversation, allMessages, activeLeafId, messageId) {
  const view = buildConversationView(allMessages, activeLeafId || messageId);
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
  const streamed = await streamReplyViaGateway({
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

function registerWebRoutes(app) {
  logger.debug('Registering web routes', {
    routeGroups: ['fonts', 'public', 'auth', 'profile', 'admin', 'characters', 'chat'],
  });

  app.get('/fonts/google.css', async (req, res) => {
    try {
      const css = await getGoogleFontCss();
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('Cache-Control', `public, max-age=${Math.floor(CSS_CACHE_TTL_MS / 1000)}, stale-while-revalidate=86400`);
      return res.send(css);
    } catch (error) {
      logFontProxyError(error, { route: '/fonts/google.css' });
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).send('/* Google Fonts proxy unavailable; system fonts fallback is active. */');
    }
  });

  app.get('/fonts/google/file', async (req, res) => {
    try {
      const rawUrl = String(req.query.url || '').trim();
      const fontFile = await getFontFile(rawUrl);
      res.setHeader('Content-Type', fontFile.contentType);
      res.setHeader('Cache-Control', `public, max-age=${Math.floor(FONT_CACHE_TTL_MS / 1000)}, immutable`);
      return res.send(fontFile.buffer);
    } catch (error) {
      logFontProxyError(error, { route: '/fonts/google/file' });
      return res.status(error.statusCode || 502).send('font unavailable');
    }
  });

  app.get('/', async (req, res, next) => {
    try {
      const characters = await listPublicCharacters();
      renderPage(res, 'home', { title: '首页', characters });
    } catch (error) {
      next(error);
    }
  });

  app.get('/register', async (req, res, next) => {
    try {
      const captcha = await createCaptcha();
      renderRegisterPage(res, { captcha });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/captcha', async (req, res, next) => {
    try {
      const previousCaptchaId = String(req.query.previousCaptchaId || '').trim();
      const captcha = previousCaptchaId ? await refreshCaptcha(previousCaptchaId) : await createCaptcha();
      res.json(captcha);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/captcha/image/:captchaId', async (req, res, next) => {
    try {
      const svg = await getCaptchaImage(String(req.params.captchaId || '').trim());
      if (!svg) {
        return res.status(404).send('captcha expired');
      }
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      return res.send(svg);
    } catch (error) {
      next(error);
    }
  });

  app.get('/healthz', async (req, res) => {
    logger.debug('Health check requested', {
      requestId: req.requestId,
      dbType: getDbType(),
      redisMode: isRedisReal() ? 'redis' : 'memory',
    });

    const checks = {
      ok: true,
      app: config.appName,
      time: new Date().toISOString(),
      dbType: getDbType(),
      redisMode: isRedisReal() ? 'redis' : 'memory',
      services: {
        database: 'unknown',
        redis: 'unknown',
      },
    };

    try {
      await query('SELECT 1');
      checks.services.database = 'ok';
    } catch (error) {
      checks.ok = false;
      checks.services.database = 'error';
      checks.databaseError = error.message;
    }

    try {
      await redisClient.ping();
      checks.services.redis = isRedisReal() ? 'ok' : 'memory';
    } catch (error) {
      checks.ok = false;
      checks.services.redis = 'error';
      checks.redisError = error.message;
    }

    return res.status(checks.ok ? 200 : 503).json(checks);
  });

  app.post('/api/send-email-code', async (req, res, next) => {
    const refreshAndRespond = async (status, payload) => {
      const nextCaptcha = await createCaptcha();
      return res.status(status).json({
        ...payload,
        nextCaptchaId: nextCaptcha.captchaId,
        nextCaptchaImageUrl: nextCaptcha.imageUrl,
        requireNewCaptcha: true,
      });
    };

    try {
      const ip = getClientIp(req);
      const email = String(req.body.email || '').trim().toLowerCase();
      const countryType = String(req.body.countryType || 'international').trim();
      const captchaId = String(req.body.captchaId || '').trim();
      const captchaText = String(req.body.captchaText || '').trim();

      const captchaPassed = await verifyCaptcha(captchaId, captchaText, true);
      if (!captchaPassed) {
        return refreshAndRespond(400, { message: '图形验证码错误或已失效，请输入新的图形验证码。' });
      }

      if (!isEmail(email)) {
        return refreshAndRespond(400, { message: '邮箱格式不正确，请输入新的图形验证码后重试。' });
      }
      if (countryType === 'international' && !isAllowedInternationalEmail(email)) {
        return refreshAndRespond(400, { message: '海外用户仅支持 Gmail、Outlook、Hotmail、Live、iCloud、Yahoo、AOL、Proton 等主流邮箱，请输入新的图形验证码后重试。' });
      }
      if (await findUserByEmail(email)) {
        return refreshAndRespond(400, { message: '邮箱已被注册，请输入新的图形验证码后重试。' });
      }

      await issueEmailCode(email, ip);
      return refreshAndRespond(200, { message: '邮箱验证码已发送。图形验证码已刷新；只有再次发送验证码时才需要填写新的图形验证码。' });
    } catch (error) {
      try {
        return refreshAndRespond(400, { message: `${error.message || '发送失败'}，请输入新的图形验证码后重试。` });
      } catch (refreshError) {
        return next(error);
      }
    }
  });

  app.post('/api/send-phone-code', async (req, res, next) => {
    const refreshAndRespond = async (status, payload) => {
      const nextCaptcha = await createCaptcha();
      return res.status(status).json({
        ...payload,
        nextCaptchaId: nextCaptcha.captchaId,
        nextCaptchaImageUrl: nextCaptcha.imageUrl,
        requireNewCaptcha: true,
      });
    };

    try {
      const ip = getClientIp(req);
      const phone = String(req.body.phone || '').trim();
      const captchaId = String(req.body.captchaId || '').trim();
      const captchaText = String(req.body.captchaText || '').trim();

      if (!isDomesticPhone(phone)) {
        return refreshAndRespond(400, { message: '请输入正确的国内手机号，并输入新的图形验证码后重试。' });
      }
      if (await findUserByPhone(phone)) {
        return refreshAndRespond(400, { message: '手机号已被注册，请输入新的图形验证码后重试。' });
      }

      const captchaPassed = await verifyCaptcha(captchaId, captchaText, true);
      if (!captchaPassed) {
        return refreshAndRespond(400, { message: '图形验证码错误或已失效，请输入新的图形验证码。' });
      }

      await verifyDomesticPhoneIdentity({ phone, captchaPassed });
      await issuePhoneCode(phone, ip);
      logger.debug('Phone verification code issued', {
        requestId: req.requestId,
        phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
        provider: 'aliyun-sms',
      });
      return refreshAndRespond(200, { message: '短信验证码已发送。图形验证码已刷新；只有再次发送验证码时才需要填写新的图形验证码。' });
    } catch (error) {
      try {
        return refreshAndRespond(400, { message: `${error.message || '发送失败'}，请输入新的图形验证码后重试。` });
      } catch (refreshError) {
        return next(error);
      }
    }
  });

  app.post('/register', async (req, res, next) => {
    const buildFormState = () => ({
      username: String(req.body.username || '').trim(),
      countryType: String(req.body.countryType || 'domestic').trim(),
      email: String(req.body.email || '').trim().toLowerCase(),
      phone: String(req.body.phone || '').trim(),
      showEmailToggle: Boolean(String(req.body.email || '').trim()),
    });

    const registerLogMeta = () => buildRegisterLogMeta(req, {
      username: req.body.username,
      countryType: req.body.countryType,
      email: req.body.email,
      phone: req.body.phone,
    });

    const renderRegisterError = async (message, reason = '') => {
      logger.warn('Register validation failed', {
        ...registerLogMeta(),
        reason: reason || message,
      });
      const nextCaptcha = await createCaptcha();
      return renderRegisterPage(res, {
        captcha: nextCaptcha,
        form: buildFormState(),
        formMessage: message,
      });
    };

    try {
      const ip = getClientIp(req);
      const limited = await hitLimit(`rate:register:${ip}`, 60, 10);
      if (limited) {
        return renderRegisterError('注册请求太频繁，请稍后再试。', 'REGISTER_RATE_LIMITED');
      }

      const username = String(req.body.username || '').trim();
      const password = String(req.body.password || '').trim();
      const countryType = String(req.body.countryType || 'domestic').trim();
      const email = String(req.body.email || '').trim().toLowerCase() || null;
      const emailCode = String(req.body.emailCode || '').trim();
      const phone = String(req.body.phone || '').trim() || null;
      const phoneCode = String(req.body.phoneCode || '').trim();
      if (username.length < 3 || password.length < 6) {
        return renderRegisterError('用户名至少 3 位，密码至少 6 位。', 'USERNAME_OR_PASSWORD_TOO_SHORT');
      }

      const existingUser = await findUserByUsername(username);
      if (existingUser) {
        return renderRegisterError('用户名已存在。', 'USERNAME_ALREADY_EXISTS');
      }

      let emailVerified = 0;
      let phoneVerified = 0;

      if (countryType === 'domestic') {
        if (!phone || !isDomesticPhone(phone)) {
          return renderRegisterError('国内用户必须填写正确手机号。', 'DOMESTIC_PHONE_INVALID');
        }
        if (await findUserByPhone(phone)) {
          return renderRegisterError('手机号已被注册。', 'PHONE_ALREADY_EXISTS');
        }
        const phoneOk = await verifyPhoneCode(phone, phoneCode);
        if (!phoneOk) {
          return renderRegisterError('短信验证码错误或已失效。', 'PHONE_CODE_INVALID');
        }
        phoneVerified = 1;

        if (email) {
          if (!isEmail(email)) {
            return renderRegisterError('邮箱格式不正确。', 'EMAIL_INVALID');
          }
          if (await findUserByEmail(email)) {
            return renderRegisterError('邮箱已被注册。', 'EMAIL_ALREADY_EXISTS');
          }
          const emailOk = await verifyEmailCode(email, emailCode);
          if (!emailOk) {
            return renderRegisterError('邮箱验证码错误或已失效。', 'EMAIL_CODE_INVALID');
          }
          emailVerified = 1;
        }
      } else {
        if (!email || !isEmail(email)) {
          return renderRegisterError('国外用户必须填写有效邮箱。', 'INTERNATIONAL_EMAIL_REQUIRED');
        }
        if (!isAllowedInternationalEmail(email)) {
          return renderRegisterError('海外用户仅支持 Gmail、Outlook、Hotmail、Live、iCloud、Yahoo、AOL、Proton 等主流邮箱。', 'INTERNATIONAL_EMAIL_PROVIDER_NOT_ALLOWED');
        }
        if (await findUserByEmail(email)) {
          return renderRegisterError('邮箱已被注册。', 'EMAIL_ALREADY_EXISTS');
        }
        const emailOk = await verifyEmailCode(email, emailCode);
        if (!emailOk) {
          return renderRegisterError('邮箱验证码错误或已失效。', 'EMAIL_CODE_INVALID');
        }
        emailVerified = 1;
      }

      const passwordHash = await hashPassword(password);
      const userId = await createUser({
        username,
        passwordHash,
        email,
        phone,
        countryType,
        emailVerified,
        phoneVerified,
      });
      logger.info('Register succeeded', {
        ...registerLogMeta(),
        userId,
      });
      req.session.user = { id: userId, username, role: 'user' };
      return res.redirect('/dashboard');
    } catch (error) {
      logger.error('Register request failed', {
        ...registerLogMeta(),
        error: error.message,
        stack: error.stack,
      });
      next(error);
    }
  });

  app.get('/login', (req, res) => renderPage(res, 'login', { title: '登录' }));
  app.post('/login', async (req, res, next) => {
    try {
      const login = String(req.body.login || '').trim();
      const password = String(req.body.password || '').trim();
      const ip = getClientIp(req);
      const limited = await hitLimit(`rate:login:${ip}`, 60, 20);
      if (limited) {
        logger.warn('Login rate limited', buildLoginLogMeta(req, { login }));
        return renderPage(res, 'message', { title: '提示', message: '登录请求太频繁，请稍后再试。' });
      }
      if (!login || !password) {
        logger.warn('Login validation failed', {
          ...buildLoginLogMeta(req, { login }),
          reason: 'LOGIN_OR_PASSWORD_EMPTY',
        });
        return renderPage(res, 'message', { title: '提示', message: '账号和密码不能为空。' });
      }
      const user = await findUserByLogin(login);

      if (!user) {
        logger.warn('Login failed', {
          ...buildLoginLogMeta(req, { login }),
          reason: 'USER_NOT_FOUND',
        });
        return renderPage(res, 'message', { title: '提示', message: '账号或密码错误。' });
      }

      const isValidPassword = await verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        logger.warn('Login failed', {
          ...buildLoginLogMeta(req, { login }),
          userId: user.id,
          reason: 'PASSWORD_MISMATCH',
        });
        return renderPage(res, 'message', { title: '提示', message: '账号或密码错误。' });
      }

      logger.info('Login succeeded', {
        ...buildLoginLogMeta(req, { login }),
        userId: user.id,
      });
      req.session.user = { id: user.id, username: user.username, role: user.role || 'user' };
      return res.redirect('/dashboard');
    } catch (error) {
      logger.error('Login request failed', {
        ...buildLoginLogMeta(req, { login: req.body.login }),
        error: error.message,
        stack: error.stack,
      });
      next(error);
    }
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  app.get('/dashboard', requireAuth, async (req, res, next) => {
    try {
      const user = await findUserById(req.session.user.id);
      if (!user) {
        // 用户记录已不存在（被删除），清除会话并跳转登录页
        return req.session.destroy(() => res.redirect('/login'));
      }
      const characters = await listUserCharacters(req.session.user.id);
      const conversations = await listUserConversations(req.session.user.id);
      const subscription = await getActiveSubscriptionForUser(req.session.user.id);
      const quota = await getUserQuotaSnapshot(req.session.user.id);
      renderPage(res, 'dashboard', { title: '控制台', user, characters, conversations, subscription, quota });
    } catch (error) {
      next(error);
    }
  });

  app.get('/profile', requireAuth, async (req, res, next) => {
    try {
      const user = await findUserById(req.session.user.id);
      if (!user) {
        return req.session.destroy(() => res.redirect('/login'));
      }
      renderPage(res, 'profile', {
        title: '个人资料',
        user,
        formMessage: '',
        formStatus: '',
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/profile', requireAuth, async (req, res, next) => {
    try {
      const action = String(req.body.action || '').trim();
      const userId = req.session.user.id;
      const user = await findUserById(userId);
      if (!user) {
        return req.session.destroy(() => res.redirect('/login'));
      }

      const renderProfileMessage = (message, status = 'error', targetUser = user) => renderPage(res, 'profile', {
        title: '个人资料',
        user: targetUser,
        formMessage: message,
        formStatus: status,
      });

      if (action === 'username') {
        const username = String(req.body.username || '').trim();
        if (username.length < 3) {
          return renderProfileMessage('用户名至少 3 位。');
        }
        if (username.length > 50) {
          return renderProfileMessage('用户名不能超过 50 位。');
        }
        if (username === user.username) {
          return renderProfileMessage('新用户名和当前用户名一样，就别折腾啦。', 'info');
        }

        const existedUser = await findUserByUsername(username);
        if (existedUser && Number(existedUser.id) !== Number(userId)) {
          return renderProfileMessage('这个用户名已经有人用了。');
        }

        await updateUsername(userId, username);
        req.session.user.username = username;
        const refreshedUser = await findUserById(userId);
        return renderProfileMessage('用户名改好了。', 'success', refreshedUser);
      }

      if (action === 'password') {
        const currentPassword = String(req.body.currentPassword || '').trim();
        const newPassword = String(req.body.newPassword || '').trim();
        const confirmPassword = String(req.body.confirmPassword || '').trim();

        if (!currentPassword || !newPassword || !confirmPassword) {
          return renderProfileMessage('改密码这几项得填完整。');
        }
        if (newPassword.length < 6) {
          return renderProfileMessage('新密码至少 6 位。');
        }
        if (newPassword !== confirmPassword) {
          return renderProfileMessage('两次输入的新密码不一致。');
        }

        const authUser = await findUserAuthById(userId);
        if (!authUser) {
          return req.session.destroy(() => res.redirect('/login'));
        }

        const isValidPassword = await verifyPassword(currentPassword, authUser.password_hash);
        if (!isValidPassword) {
          return renderProfileMessage('当前密码不对。');
        }

        const isSamePassword = await verifyPassword(newPassword, authUser.password_hash);
        if (isSamePassword) {
          return renderProfileMessage('新密码不能和现在这个一样。', 'info');
        }

        const passwordHash = await hashPassword(newPassword);
        await updatePasswordHash(userId, passwordHash);
        const refreshedUser = await findUserById(userId);
        return renderProfileMessage('密码已经更新好了。', 'success', refreshedUser);
      }

      return renderProfileMessage('不认识这个资料操作。');
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin', requireAdmin, async (req, res, next) => {
    try {
      const [overview, users, plans] = await Promise.all([
        getAdminOverview(),
        listUsersWithPlans(),
        listPlans(),
      ]);

      renderPage(res, 'admin', {
        title: '管理员后台',
        overview,
        users,
        plans,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/plans', requireAdmin, async (req, res, next) => {
    try {
      const [overview, plans] = await Promise.all([
        getAdminOverview(),
        listPlans(),
      ]);

      renderPage(res, 'admin-plans', {
        title: '套餐配置',
        overview,
        plans,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/providers', requireAdmin, async (req, res, next) => {
    try {
      const [overview, providers] = await Promise.all([
        getAdminOverview(),
        listProviders(),
      ]);

      renderPage(res, 'admin-providers', {
        title: 'LLM 配置',
        overview,
        providers,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/prompts', requireAdmin, async (req, res, next) => {
    try {
      const promptBlocks = await listPromptBlocks();
      const promptPreview = buildPromptPreview({
        promptBlocks: promptBlocks.map((item) => ({
          key: item.block_key,
          value: item.block_value,
          sortOrder: item.sort_order,
          isEnabled: item.is_enabled,
        })),
        character: {},
      });

      const promptPreviewMeta = {
        modeLabel: '纯全局片段预览',
        description: '这里只展示当前启用的全局提示词片段拼接结果，不再注入任何示例角色字段占位。',
      };

      renderPage(res, 'admin-prompts', {
        title: 'Prompt 配置',
        promptBlocks,
        promptPreview,
        promptPreviewMeta,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/logs', requireAdmin, async (req, res, next) => {
    try {
      const logResult = listLogEntries({
        date: req.query.date,
        level: req.query.level,
        file: req.query.file,
        errorType: req.query.errorType,
        functionName: req.query.functionName,
        page: parseIntegerField(req.query.page, { fieldLabel: '页码', defaultValue: 1, min: 1 }),
        pageSize: parseIntegerField(req.query.pageSize, { fieldLabel: '分页大小', defaultValue: 50, min: 1 }),
      });

      const buildPageUrl = (targetPage) => {
        const params = new URLSearchParams();
        Object.entries({ ...logResult.filters, page: targetPage, pageSize: logResult.pageSize }).forEach(([key, value]) => {
          if (value !== undefined && value !== null && String(value).trim() !== '') {
            params.set(key, String(value));
          }
        });
        return `/admin/logs?${params.toString()}`;
      };

      renderPage(res, 'admin-logs', {
        title: '日志查询',
        logResult,
        buildPageUrl,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/conversations', requireAdmin, async (req, res, next) => {
    try {
      const conversationResult = await listAdminConversations({
        userId: req.query.userId,
        characterId: req.query.characterId,
        date: req.query.date,
        status: req.query.status,
        page: parseIntegerField(req.query.page, { fieldLabel: '页码', defaultValue: 1, min: 1 }),
        pageSize: parseIntegerField(req.query.pageSize, { fieldLabel: '分页大小', defaultValue: 25, min: 1 }),
      });

      const buildPageUrl = (targetPage) => {
        const params = new URLSearchParams();
        Object.entries({
          ...conversationResult.filters,
          page: targetPage,
          pageSize: conversationResult.pageSize,
        }).forEach(([key, value]) => {
          if (value !== undefined && value !== null && String(value).trim() !== '' && Number(value) !== 0) {
            params.set(key, String(value));
          }
        });
        return `/admin/conversations?${params.toString()}`;
      };

      renderPage(res, 'admin-conversations', {
        title: '全局对话记录',
        conversationResult,
        buildPageUrl,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/conversations/:conversationId', requireAdmin, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const detail = await getAdminConversationDetail(conversationId);
      if (!detail) {
        return renderValidationMessage(res, '这条对话记录不存在。', '全局对话记录');
      }

      renderPage(res, 'admin-conversation-detail', {
        title: `对话 #${conversationId}`,
        detail,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/conversations/:conversationId/restore', requireAdmin, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      await restoreConversation(conversationId);
      return res.redirect(`/admin/conversations/${conversationId}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/conversations/:conversationId/permanent-delete', requireAdmin, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      await permanentlyDeleteConversation(conversationId);
      return res.redirect('/admin/conversations?status=deleted');
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/conversations/:conversationId/messages/:messageId/restore', requireAdmin, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      await restoreMessage(conversationId, messageId);
      invalidateConversationCache(conversationId).catch(() => {});
      return res.redirect(`/admin/conversations/${conversationId}#message-${messageId}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/conversations/:conversationId/messages/:messageId/permanent-delete', requireAdmin, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      try {
        await permanentlyDeleteMessage(conversationId, messageId);
      } catch (error) {
        if (error.code === 'MESSAGE_HAS_CHILDREN') {
          return renderValidationMessage(res, `这条消息还有 ${error.childMessageCount} 条子消息，不能单独永久删除。`, '全局对话记录');
        }
        throw error;
      }
      invalidateConversationCache(conversationId).catch(() => {});
      return res.redirect(`/admin/conversations/${conversationId}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/plans/new', requireAdmin, async (req, res, next) => {
    try {
      const code = String(req.body.code || '').trim();
      const name = String(req.body.name || '').trim();
      if (!code || !name) {
        return renderValidationMessage(res, '新增套餐时，code 和 name 不能为空。');
      }

      await createPlan({
        code,
        name,
        description: String(req.body.description || '').trim(),
        billingMode: String(req.body.billingMode || 'per_request').trim(),
        quotaPeriod: String(req.body.quotaPeriod || 'monthly').trim(),
        requestQuota: parseIntegerField(req.body.requestQuota, { fieldLabel: '请求额度', defaultValue: 0, min: 0 }),
        tokenQuota: parseIntegerField(req.body.tokenQuota, { fieldLabel: 'Token 额度', defaultValue: 0, min: 0 }),
        priorityWeight: parseIntegerField(req.body.priorityWeight, { fieldLabel: '优先级权重', defaultValue: 0, min: 0 }),
        concurrencyLimit: parseIntegerField(req.body.concurrencyLimit, { fieldLabel: '并发上限', defaultValue: 1, min: 1 }),
        maxOutputTokens: parseIntegerField(req.body.maxOutputTokens, { fieldLabel: '最大输出 Token', defaultValue: 1024, min: 1 }),
        status: String(req.body.status || 'active').trim(),
        isDefault: String(req.body.isDefault || '') === '1',
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/plans');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/plans/:planId', requireAdmin, async (req, res, next) => {
    try {
      const planId = parseIdParam(req.params.planId, '套餐 ID');
      const plan = await findPlanById(planId);
      if (!plan) {
        return renderValidationMessage(res, '套餐不存在。');
      }

      await updatePlan(planId, {
        name: String(req.body.name || '').trim(),
        description: String(req.body.description || '').trim(),
        billingMode: String(req.body.billingMode || 'per_request').trim(),
        quotaPeriod: String(req.body.quotaPeriod || 'monthly').trim(),
        requestQuota: parseIntegerField(req.body.requestQuota, { fieldLabel: '请求额度', defaultValue: 0, min: 0 }),
        tokenQuota: parseIntegerField(req.body.tokenQuota, { fieldLabel: 'Token 额度', defaultValue: 0, min: 0 }),
        priorityWeight: parseIntegerField(req.body.priorityWeight, { fieldLabel: '优先级权重', defaultValue: 0, min: 0 }),
        concurrencyLimit: parseIntegerField(req.body.concurrencyLimit, { fieldLabel: '并发上限', defaultValue: 1, min: 1 }),
        maxOutputTokens: parseIntegerField(req.body.maxOutputTokens, { fieldLabel: '最大输出 Token', defaultValue: 1024, min: 1 }),
        status: String(req.body.status || 'active').trim(),
        isDefault: String(req.body.isDefault || '') === '1',
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/plans');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/plans/:planId/delete', requireAdmin, async (req, res, next) => {
    try {
      const planId = parseIdParam(req.params.planId, '套餐 ID');
      const plan = await findPlanById(planId);
      if (!plan) {
        return renderValidationMessage(res, '套餐不存在。');
      }

      try {
        await deletePlan(planId);
      } catch (error) {
        if (error.message === 'PLAN_IN_USE') {
          return renderValidationMessage(res, '这个套餐已经被订阅或历史记录引用，暂时不能删除。先解绑/更换用户套餐，再删。');
        }
        throw error;
      }

      return res.redirect('/admin/plans');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/users/:userId/role', requireAdmin, async (req, res, next) => {
    try {
      const userId = parseIdParam(req.params.userId, '用户 ID');
      const role = String(req.body.role || 'user').trim();
      if (!['user', 'admin'].includes(role)) {
        return renderValidationMessage(res, '角色类型不支持。');
      }
      await updateUserRole(userId, role);
      return res.redirect('/admin');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/users/:userId/plan', requireAdmin, async (req, res, next) => {
    try {
      const userId = parseIdParam(req.params.userId, '用户 ID');
      const planId = parseIdParam(req.body.planId, '套餐 ID');
      const plan = await findPlanById(planId);
      if (!plan) {
        return renderValidationMessage(res, '套餐不存在。');
      }
      await updateUserPlan(userId, planId);
      return res.redirect('/admin');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/providers/new', requireAdmin, async (req, res, next) => {
    try {
      const name = String(req.body.name || '').trim();
      const baseUrl = String(req.body.baseUrl || '').trim();
      const apiKey = String(req.body.apiKey || '').trim();
      if (!name || !baseUrl || !apiKey) {
        return renderValidationMessage(res, '新增 Provider 时，名称、Base URL、API Key 不能为空。模型可在保存后从 API 返回列表里搜索选择。');
      }

      await createProvider({
        name,
        baseUrl,
        apiKey,
        standardModel: String(req.body.standardModel || '').trim(),
        jailbreakModel: String(req.body.jailbreakModel || '').trim(),
        forceJailbreakModel: String(req.body.forceJailbreakModel || '').trim(),
        compressionModel: String(req.body.compressionModel || '').trim(),
        maxContextTokens: parseIntegerField(req.body.maxContextTokens, { fieldLabel: '最大上下文 Token', defaultValue: 81920, min: 1 }),
        trimContextTokens: parseIntegerField(req.body.trimContextTokens, { fieldLabel: '裁剪上下文 Token', defaultValue: 61440, min: 1 }),
        isActive: String(req.body.isActive || '') === '1',
        status: String(req.body.status || 'active').trim(),
        maxConcurrency: parseIntegerField(req.body.maxConcurrency, { fieldLabel: '最大并发数', defaultValue: 5, min: 1 }),
        timeoutMs: parseIntegerField(req.body.timeoutMs, { fieldLabel: '超时时间(ms)', defaultValue: 60000, min: 1 }),
        inputTokenPrice: parseNumberField(req.body.inputTokenPrice, { fieldLabel: '输入 Token 单价', defaultValue: 0, min: 0 }),
        outputTokenPrice: parseNumberField(req.body.outputTokenPrice, { fieldLabel: '输出 Token 单价', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/providers');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/providers/:providerId', requireAdmin, async (req, res, next) => {
    try {
      const providerId = parseIdParam(req.params.providerId, 'Provider ID');
      await updateProvider(providerId, {
        name: req.body.name,
        baseUrl: req.body.baseUrl,
        apiKey: req.body.apiKey,
        standardModel: req.body.standardModel,
        jailbreakModel: req.body.jailbreakModel,
        forceJailbreakModel: req.body.forceJailbreakModel,
        compressionModel: req.body.compressionModel,
        maxContextTokens: parseIntegerField(req.body.maxContextTokens, { fieldLabel: '最大上下文 Token', defaultValue: 81920, min: 1 }),
        trimContextTokens: parseIntegerField(req.body.trimContextTokens, { fieldLabel: '裁剪上下文 Token', defaultValue: 61440, min: 1 }),
        refreshModels: String(req.body.refreshModels || '') === '1' ? '1' : '0',
        isActive: String(req.body.isActive || '') === '1',
        status: String(req.body.status || 'active').trim(),
        maxConcurrency: parseIntegerField(req.body.maxConcurrency, { fieldLabel: '最大并发数', defaultValue: 5, min: 1 }),
        timeoutMs: parseIntegerField(req.body.timeoutMs, { fieldLabel: '超时时间(ms)', defaultValue: 60000, min: 1 }),
        inputTokenPrice: parseNumberField(req.body.inputTokenPrice, { fieldLabel: '输入 Token 单价', defaultValue: 0, min: 0 }),
        outputTokenPrice: parseNumberField(req.body.outputTokenPrice, { fieldLabel: '输出 Token 单价', defaultValue: 0, min: 0 }),
      });
      return res.redirect('/admin/providers');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/prompt-blocks/new', requireAdmin, async (req, res, next) => {
    try {
      const key = String(req.body.key || '').trim();
      const value = String(req.body.value || '').trim();
      if (!key || !value) {
        return renderValidationMessage(res, '提示词片段的 key 和 value 不能为空。');
      }

      await createPromptBlock({
        key,
        value,
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
        isEnabled: String(req.body.isEnabled || '1') !== '0',
      });
      return res.redirect('/admin/prompts');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/prompt-blocks/:blockId', requireAdmin, async (req, res, next) => {
    try {
      const blockId = parseIdParam(req.params.blockId, '提示词片段 ID');
      await updatePromptBlock(blockId, {
        key: req.body.key,
        value: req.body.value,
        sortOrder: parseIntegerField(req.body.sortOrder, { fieldLabel: '排序值', defaultValue: 0, min: 0 }),
        isEnabled: String(req.body.isEnabled || '1') !== '0',
      });
      return res.redirect('/admin/prompts');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/prompt-blocks/reorder', requireAdmin, async (req, res, next) => {
    try {
      const blockIds = String(req.body.blockIds || '')
        .split(',')
        .map((item) => parseIntegerField(item, { fieldLabel: '提示词片段 ID', min: 1, allowEmpty: true }))
        .filter((item) => item > 0);
      await reorderPromptBlocks(blockIds);
      return res.redirect('/admin/prompts');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.post('/admin/prompt-blocks/:blockId/delete', requireAdmin, async (req, res, next) => {
    try {
      const blockId = parseIdParam(req.params.blockId, '提示词片段 ID');
      await deletePromptBlock(blockId);
      return res.redirect('/admin/prompts');
    } catch (error) {
      if (error.message.includes('必须') || error.message.includes('不能小于') || error.message.includes('不能为空') || error.message.includes('超出允许范围')) {
        return renderValidationMessage(res, error.message);
      }
      next(error);
    }
  });

  app.get('/characters/new', requireAuth, (req, res) => {
    renderPage(res, 'character-new', {
      title: '创建角色',
      mode: 'create',
      form: { visibility: 'public' },
      extraPromptItems: [],
    });
  });

  app.get('/characters/:characterId/edit', requireAuth, async (req, res, next) => {
    try {
      const characterId = parseIdParam(req.params.characterId, '角色 ID');
      const character = await getCharacterById(characterId, req.session.user.id);
      if (!character) {
        return renderPage(res, 'message', { title: '提示', message: '角色不存在或无权编辑。' });
      }

      const { structured, extraItems } = splitCharacterPromptProfile(character.prompt_profile_json);

      renderPage(res, 'character-new', {
        title: '编辑角色',
        mode: 'edit',
        character,
        form: {
          name: character.name,
          summary: character.summary,
          role: structured.role,
          traitDescription: structured.traitDescription || character.personality,
          currentScene: structured.currentScene,
          currentBackground: structured.currentBackground,
          firstMessage: character.first_message,
          visibility: character.visibility === 'private' ? 'private' : 'public',
        },
        extraPromptItems: extraItems,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/characters/new', requireAuth, async (req, res, next) => {
    try {
      const promptProfileItems = buildCharacterPromptProfileFromForm(req.body);
      const payload = {
        name: String(req.body.name || '').trim(),
        summary: String(req.body.summary || '').trim(),
        personality: String(req.body.traitDescription || '').trim(),
        firstMessage: String(req.body.firstMessage || '').trim(),
        promptProfileJson: JSON.stringify(promptProfileItems),
        visibility: String(req.body.visibility || 'public').trim() === 'private' ? 'private' : 'public',
      };

      await createCharacter(req.session.user.id, payload);
      return res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  });

  app.post('/characters/:characterId/edit', requireAuth, async (req, res, next) => {
    try {
      const characterId = parseIdParam(req.params.characterId, '角色 ID');
      const character = await getCharacterById(characterId, req.session.user.id);
      if (!character) {
        return renderPage(res, 'message', { title: '提示', message: '角色不存在或无权编辑。' });
      }

      const promptProfileItems = buildCharacterPromptProfileFromForm(req.body);
      const payload = {
        name: String(req.body.name || '').trim(),
        summary: String(req.body.summary || '').trim(),
        personality: String(req.body.traitDescription || '').trim(),
        firstMessage: String(req.body.firstMessage || '').trim(),
        promptProfileJson: JSON.stringify(promptProfileItems),
        visibility: String(req.body.visibility || 'public').trim() === 'private' ? 'private' : 'public',
      };

      await updateCharacter(characterId, req.session.user.id, payload);
      return res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  });

  app.post('/characters/:characterId/delete', requireAuth, async (req, res, next) => {
    try {
      const characterId = parseIdParam(req.params.characterId, '角色 ID');
      try {
        await deleteCharacterSafely(characterId, req.session.user.id);
      } catch (error) {
        if (error.code === 'CHARACTER_NOT_FOUND') {
          return renderPage(res, 'message', { title: '提示', message: '角色不存在或无权删除。' });
        }
        if (error.code === 'CHARACTER_HAS_CONVERSATIONS') {
          return renderPage(res, 'message', {
            title: '暂时不能删除角色',
            message: `这个角色下面还有 ${error.conversationCount} 条对话记录。为了避免把分支会话整串误删，现在只允许删除“从未开过对话”的角色。你可以先保留角色，或后面再做更细的归档/迁移方案。`,
          });
        }
        throw error;
      }

      return res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  });

  app.post('/conversations/start/:characterId', requireAuth, async (req, res, next) => {
    try {
      const characterId = parseIdParam(req.params.characterId, '角色 ID');
      let character = await getCharacterById(characterId, req.session.user.id);

      if (!character) {
        character = await getCharacterById(characterId);
      }

      if (!character || (character.visibility !== 'public' && Number(character.user_id) !== Number(req.session.user.id))) {
        return renderPage(res, 'message', { title: '提示', message: '角色不存在。' });
      }

      const conversationId = await createConversation(req.session.user.id, characterId, {
        title: `${character.name} · 新对话`,
        selectedModelMode: String(req.body.modelMode || 'standard').trim(),
      });

      if (String(character.first_message || '').trim()) {
        const userMessageId = await addMessage({
          conversationId,
          senderType: 'user',
          content: '[开始一次新的对话]',
          promptKind: 'conversation-start',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'conversation-start-user-seed',
            autoGenerated: true,
          }),
        });

        const replyMessageId = await addMessage({
          conversationId,
          senderType: 'character',
          content: applyRuntimeTemplate(String(character.first_message || '').trim(), { username: req.session.user.username, user: req.session.user.username, timeZone: 'Asia/Hong_Kong' }),
          parentMessageId: userMessageId,
          branchFromMessageId: userMessageId,
          promptKind: 'first-message',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'character-first-message',
          }),
        });

        return res.redirect(`/chat/${conversationId}?leaf=${replyMessageId}`);
      }

      return res.redirect(`/chat/${conversationId}`);
    } catch (error) {
      next(error);
    }
  });

  app.get('/chat/:conversationId', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      logger.debug('Rendering chat page', {
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        requestedLeafId: req.query.leaf || null,
      });

      await renderChatPage(req, res, conversation);
    } catch (error) {
      next(error);
    }
  });

  app.get('/chat/:conversationId/messages/history', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const beforeId = parseIntegerField(req.query.beforeId || req.query.before, { fieldLabel: '起始消息 ID', min: 1, allowEmpty: true });
      const limit = Math.min(parseIntegerField(req.query.limit || '10', { fieldLabel: '加载数量', min: 1 }), 30);
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const allMessages = await listMessages(conversationId);
      const fallbackLeafId = conversation.current_message_id || (allMessages.length ? allMessages[allMessages.length - 1].id : null);
      const leafId = parseIntegerField(req.query.leaf || fallbackLeafId || '', { fieldLabel: '叶子消息 ID', min: 1, allowEmpty: true }) || fallbackLeafId;
      const view = buildConversationView(allMessages, leafId);
      const beforeIndex = beforeId
        ? view.pathMessages.findIndex((message) => Number(message.id) === Number(beforeId))
        : view.pathMessages.length;
      const end = beforeIndex >= 0 ? beforeIndex : view.pathMessages.length;
      const start = Math.max(0, end - limit);
      const messages = view.pathMessages.slice(start, end);
      const htmlParts = [];
      for (const message of messages) {
        htmlParts.push(await renderChatMessageHtml(req, conversation, message));
      }

      res.json({
        ok: true,
        html: htmlParts.join('\n'),
        count: messages.length,
        hasMore: start > 0,
        nextBeforeId: messages.length ? messages[0].id : beforeId || null,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/delete', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      try {
        await deleteConversationSafely(conversationId, req.session.user.id);
      } catch (error) {
        if (error.code === 'CONVERSATION_NOT_FOUND') {
          return renderPage(res, 'message', { title: '提示', message: '会话不存在或无权删除。' });
        }
        throw error;
      }

      return res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/message', requireAuth, async (req, res, next) => {
    let conversationId;
    try {
      conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const rawContent = String(req.body.content || '');
      const parentMessageId = parseIntegerField(req.body.parentMessageId, { fieldLabel: '父消息 ID', min: 1, allowEmpty: true });

      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const allMessages = await listMessages(conversationId);
      const chatRequest = buildChatRequestContext(req, conversation, allMessages, rawContent, parentMessageId);
      const { isFirstTurn, content, history, isBranchReply, promptKind } = chatRequest;

      if (!content) {
        return renderPage(res, 'message', { title: '提示', message: '消息不能为空。' });
      }

      const userMessageId = await addMessage({
        conversationId,
        senderType: 'user',
        content,
        parentMessageId,
        branchFromMessageId: parentMessageId,
        promptKind: isFirstTurn ? 'conversation-start' : (isBranchReply ? 'branch' : 'normal'),
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'user-message',
          autoGenerated: isFirstTurn && !rawContent.trim(),
        }),
      });

      const reply = await generateReplyViaGateway({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: {
          name: conversation.character_name,
          summary: conversation.character_summary,
          personality: conversation.personality,
          prompt_profile_json: conversation.prompt_profile_json,
        },
        messages: history,
        userMessage: content,
        promptKind,
        modelMode: conversation.selected_model_mode || 'standard',
        user: req.session.user,
      });

      const replyMessageId = await addMessage({
        conversationId,
        senderType: 'character',
        content: reply,
        parentMessageId: userMessageId,
        branchFromMessageId: userMessageId,
        promptKind: isFirstTurn ? 'conversation-start' : (isBranchReply ? 'branch' : 'normal'),
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'assistant-reply',
        }),
      });

      await updateConversationTitle(conversationId, buildNextConversationTitle(conversation, content));
      return res.redirect(`/chat/${conversationId}?leaf=${replyMessageId}`);
    } catch (error) {
      const isQuotaError = error.message === 'REQUEST_QUOTA_EXCEEDED' || error.message === 'TOKEN_QUOTA_EXCEEDED';
      if (!isQuotaError && conversationId) {
        try {
          const conv = await getConversationById(conversationId, req.session.user.id);
          if (conv) {
            return await renderChatPage(req, res, conv, {
              errorMessage: 'AI 回复失败，请稍后重试。如持续出现，请联系管理员。',
            });
          }
        } catch (_) { /* 渲染失败时降级到全局错误处理 */ }
      }
      return next(error);
    }
  });

  app.post('/chat/:conversationId/message/stream', requireAuth, async (req, res, next) => {
    let conversationId;
    const ndjson = createNdjsonResponder(req, res);
    try {
      conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const rawContent = String(req.body.content || '');
      const parentMessageId = parseIntegerField(req.body.parentMessageId, { fieldLabel: '父消息 ID', min: 1, allowEmpty: true });

      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        ndjson.end();
        return;
      }

      const allMessages = await listMessages(conversationId);
      const chatRequest = buildChatRequestContext(req, conversation, allMessages, rawContent, parentMessageId);
      const { isFirstTurn, content, history, isBranchReply, promptKind } = chatRequest;

      if (!content) {
        ndjson.safeWrite({ type: 'error', message: '消息不能为空。' });
        ndjson.end();
        return;
      }

      const userMessageId = await addMessage({
        conversationId,
        senderType: 'user',
        content,
        parentMessageId,
        branchFromMessageId: parentMessageId,
        promptKind: isFirstTurn ? 'conversation-start' : (isBranchReply ? 'branch' : 'normal'),
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'user-message',
          autoGenerated: isFirstTurn && !rawContent.trim(),
          delivery: 'stream',
        }),
      });

      const messagesWithUser = await listMessages(conversationId);
      const userPacket = await buildChatMessagePacket(req, conversation, messagesWithUser, userMessageId, userMessageId);
      ndjson.safeWrite({
        type: 'user-message',
        conversationId,
        userMessageId,
        content,
        leafId: userMessageId,
        html: userPacket ? userPacket.html : '',
      });
      ndjson.safeWrite({ type: 'assistant-start', conversationId, parentMessageId: userMessageId, mode: 'message' });

      const replyContent = await streamChatReplyToNdjson({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: buildConversationCharacterPayload(conversation),
        messages: history,
        userMessage: content,
        promptKind,
        modelMode: conversation.selected_model_mode || 'standard',
        signal: ndjson.abortController.signal,
        safeWrite: ndjson.safeWrite,
        user: req.session.user,
      });

      if (ndjson.isClosed() || ndjson.abortController.signal.aborted) {
        return;
      }

      const replyMessageId = await addMessage({
        conversationId,
        senderType: 'character',
        content: replyContent,
        parentMessageId: userMessageId,
        branchFromMessageId: userMessageId,
        promptKind: isFirstTurn ? 'conversation-start' : (isBranchReply ? 'branch' : 'normal'),
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'assistant-reply-stream',
        }),
      });

      await updateConversationTitle(conversationId, buildNextConversationTitle(conversation, content));
      await invalidateConversationCache(conversationId);
      const messagesWithReply = await listMessages(conversationId);
      const replyPacket = await buildChatMessagePacket(req, conversation, messagesWithReply, replyMessageId, replyMessageId);
      const parentPacket = await buildChatMessagePacket(req, conversation, messagesWithReply, replyMessageId, userMessageId);
      ndjson.safeWrite({
        type: 'done',
        conversationId,
        replyMessageId,
        leafId: replyMessageId,
        full: replyContent,
        mode: 'message',
        html: replyPacket ? replyPacket.html : '',
        parentMessageId: userMessageId,
        parentHtml: parentPacket ? parentPacket.html : '',
      });
      ndjson.end();
      return;
    } catch (error) {
      if (!res.headersSent) {
        return next(error);
      }
      ndjson.fail(error);
    }
  });

  app.post('/chat/:conversationId/regenerate/:messageId/stream', requireAuth, async (req, res, next) => {
    const ndjson = createNdjsonResponder(req, res);
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        ndjson.end();
        return;
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage || targetMessage.sender_type !== 'character') {
        ndjson.safeWrite({ type: 'error', message: '只能重新生成 AI 回复。' });
        ndjson.end();
        return;
      }

      const allMessages = await listMessages(conversationId);
      const parentUserMessage = targetMessage.parent_message_id
        ? await getMessageById(conversationId, targetMessage.parent_message_id)
        : null;

      if (!parentUserMessage || parentUserMessage.sender_type !== 'user') {
        ndjson.safeWrite({ type: 'error', message: '找不到对应的用户输入。' });
        ndjson.end();
        return;
      }

      const history = buildPathMessages(allMessages, parentUserMessage.id).slice(0, -1);
      ndjson.safeWrite({
        type: 'assistant-start',
        conversationId,
        parentMessageId: parentUserMessage.id,
        sourceMessageId: messageId,
        mode: 'regenerate',
      });

      const reply = await streamChatReplyToNdjson({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: buildConversationCharacterPayload(conversation),
        messages: history,
        userMessage: parentUserMessage.content,
        systemHint: '这是一次重新生成。请在保持角色一致的前提下，给出与先前不同但同样合理的新回复。',
        promptKind: 'regenerate',
        modelMode: conversation.selected_model_mode || 'standard',
        signal: ndjson.abortController.signal,
        safeWrite: ndjson.safeWrite,
        user: req.session.user,
      });

      if (ndjson.isClosed() || ndjson.abortController.signal.aborted) {
        return;
      }

      const newReplyId = await addMessage({
        conversationId,
        senderType: 'character',
        content: reply,
        parentMessageId: parentUserMessage.id,
        branchFromMessageId: messageId,
        editedFromMessageId: messageId,
        promptKind: 'regenerate',
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'assistant-regenerate-stream',
          sourceMessageId: messageId,
        }),
      });

      await invalidateConversationCache(conversationId);
      const messagesWithReply = await listMessages(conversationId);
      const replyPacket = await buildChatMessagePacket(req, conversation, messagesWithReply, newReplyId, newReplyId);
      ndjson.safeWrite({
        type: 'done',
        conversationId,
        replyMessageId: newReplyId,
        leafId: newReplyId,
        full: reply,
        mode: 'regenerate',
        html: replyPacket ? replyPacket.html : '',
      });
      ndjson.end();
    } catch (error) {
      if (!res.headersSent) {
        return next(error);
      }
      ndjson.fail(error);
    }
  });

  app.post('/chat/:conversationId/regenerate/:messageId', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage || targetMessage.sender_type !== 'character') {
        return renderPage(res, 'message', { title: '提示', message: '只能重新生成 AI 回复。' });
      }

      const allMessages = await listMessages(conversationId);
      const parentUserMessage = targetMessage.parent_message_id
        ? await getMessageById(conversationId, targetMessage.parent_message_id)
        : null;

      if (!parentUserMessage || parentUserMessage.sender_type !== 'user') {
        return renderPage(res, 'message', { title: '提示', message: '找不到对应的用户输入。' });
      }

      const history = buildPathMessages(allMessages, parentUserMessage.id).slice(0, -1);
      const reply = await generateReplyViaGateway({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: buildConversationCharacterPayload(conversation),
        messages: history,
        userMessage: parentUserMessage.content,
        systemHint: '这是一次重新生成。请在保持角色一致的前提下，给出与先前不同但同样合理的新回复。',
        promptKind: 'regenerate',
        modelMode: conversation.selected_model_mode || 'standard',
        user: req.session.user,
      });

      const newReplyId = await addMessage({
        conversationId,
        senderType: 'character',
        content: reply,
        parentMessageId: parentUserMessage.id,
        branchFromMessageId: messageId,
        editedFromMessageId: messageId,
        promptKind: 'regenerate',
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'assistant-regenerate',
          sourceMessageId: messageId,
        }),
      });

      return res.redirect(`/chat/${conversationId}?leaf=${newReplyId}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/messages/:messageId/delete', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      try {
        const result = await deleteMessageSafely(conversationId, messageId, req.session.user.id);
        const nextLeaf = result.fallbackMessageId || '';
        return res.redirect(nextLeaf ? `/chat/${conversationId}?leaf=${nextLeaf}` : `/chat/${conversationId}`);
      } catch (error) {
        if (error.code === 'MESSAGE_NOT_FOUND') {
          return renderPage(res, 'message', { title: '提示', message: '这条对话记录不存在。' });
        }
        if (error.code === 'MESSAGE_HAS_CHILDREN') {
          return renderChatPage(req, res, conversation, {
            leafId: conversation.current_message_id || null,
            errorMessage: `这条对话记录下面还有 ${error.childMessageCount} 条后续消息。为了避免把分支链路删断，现在只允许删除末端叶子消息。`,
          });
        }
        if (error.code === 'MESSAGE_HAS_BRANCH_CONVERSATIONS') {
          return renderChatPage(req, res, conversation, {
            leafId: conversation.current_message_id || null,
            errorMessage: `这条对话记录已经被拿去开了 ${error.branchConversationCount} 条独立分支会话。为了避免分支引用悬空，现在不能删它。`,
          });
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/messages/:messageId/edit', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const content = String(req.body.content || '').trim();
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }
      if (!content) {
        return renderPage(res, 'message', { title: '提示', message: '内容不能为空。' });
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage || targetMessage.sender_type !== 'character') {
        return renderPage(res, 'message', { title: '提示', message: '这里只支持修改 AI 生成内容。' });
      }

      const variantMessageId = await createEditedMessageVariant(conversationId, messageId, content);
      return res.redirect(`/chat/${conversationId}?leaf=${variantMessageId}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/messages/:messageId/edit-user', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const content = String(req.body.content || '').trim();
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }
      if (!content) {
        return renderPage(res, 'message', { title: '提示', message: '内容不能为空。' });
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage || targetMessage.sender_type !== 'user') {
        return renderPage(res, 'message', { title: '提示', message: '这里只支持修改用户输入。' });
      }

      const allMessages = await listMessages(conversationId);
      const historyBeforeUser = targetMessage.parent_message_id
        ? buildPathMessages(allMessages, targetMessage.parent_message_id)
        : [];

      const newUserMessageId = await addMessage({
        conversationId,
        senderType: 'user',
        content,
        parentMessageId: targetMessage.parent_message_id || null,
        branchFromMessageId: targetMessage.id,
        editedFromMessageId: targetMessage.id,
        promptKind: 'edit',
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'user-edit-branch',
          sourceMessageId: messageId,
        }),
      });

      const reply = await generateReplyViaGateway({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: {
          name: conversation.character_name,
          summary: conversation.character_summary,
          personality: conversation.personality,
          prompt_profile_json: conversation.prompt_profile_json,
        },
        messages: historyBeforeUser,
        userMessage: content,
        systemHint: '这是基于用户改写后的旧输入重新开出的分支，请自然延续，不要提到你被要求重生成。',
        promptKind: 'edit',
        modelMode: conversation.selected_model_mode || 'standard',
        user: req.session.user,
      });

      const replyMessageId = await addMessage({
        conversationId,
        senderType: 'character',
        content: reply,
        parentMessageId: newUserMessageId,
        branchFromMessageId: newUserMessageId,
        promptKind: 'branch',
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'assistant-reply-from-user-edit',
          sourceMessageId: messageId,
        }),
      });

      return res.redirect(`/chat/${conversationId}?leaf=${replyMessageId}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/messages/:messageId/replay/stream', requireAuth, async (req, res, next) => {
    const ndjson = createNdjsonResponder(req, res);
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        ndjson.end();
        return;
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage) {
        ndjson.safeWrite({ type: 'error', message: '重算起点不存在。' });
        ndjson.end();
        return;
      }
      if (!targetMessage.parent_message_id) {
        ndjson.safeWrite({ type: 'error', message: '根节点不适合做后续重算。' });
        ndjson.end();
        return;
      }

      const allMessages = await listMessages(conversationId);
      const historyBeforeTarget = buildPathMessages(allMessages, targetMessage.parent_message_id);
      let newLeafId = null;
      let previewUserContent = '';
      let reply = '';

      if (targetMessage.sender_type === 'user') {
        const newUserMessageId = await addMessage({
          conversationId,
          senderType: 'user',
          content: targetMessage.content,
          parentMessageId: targetMessage.parent_message_id || null,
          branchFromMessageId: targetMessage.id,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'user-replay-branch',
            sourceMessageId: messageId,
            delivery: 'stream',
          }),
        });

        previewUserContent = targetMessage.content;
        const userPacket = await buildChatMessagePacket(req, conversation, await listMessages(conversationId), newUserMessageId, newUserMessageId);
        ndjson.safeWrite({ type: 'user-message', conversationId, userMessageId: newUserMessageId, content: previewUserContent, leafId: newUserMessageId, mode: 'replay', html: userPacket ? userPacket.html : '' });
        ndjson.safeWrite({ type: 'assistant-start', conversationId, parentMessageId: newUserMessageId, sourceMessageId: messageId, mode: 'replay' });

        reply = await streamChatReplyToNdjson({
          requestId: req.requestId,
          userId: req.session.user.id,
          conversationId,
          character: buildConversationCharacterPayload(conversation),
          messages: historyBeforeTarget,
          userMessage: targetMessage.content,
          systemHint: '这是一次从旧节点开始的后续重算，请自然延续并给出新的合理走向。',
          promptKind: 'replay',
          modelMode: conversation.selected_model_mode || 'standard',
          signal: ndjson.abortController.signal,
          safeWrite: ndjson.safeWrite,
          user: req.session.user,
        });

        if (ndjson.isClosed() || ndjson.abortController.signal.aborted) {
          return;
        }

        newLeafId = await addMessage({
          conversationId,
          senderType: 'character',
          content: reply,
          parentMessageId: newUserMessageId,
          branchFromMessageId: newUserMessageId,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'assistant-replay-after-user-stream',
            sourceMessageId: messageId,
          }),
        });
      } else {
        const parentUserMessage = await getMessageById(conversationId, targetMessage.parent_message_id);
        if (!parentUserMessage || parentUserMessage.sender_type !== 'user') {
          ndjson.safeWrite({ type: 'error', message: '找不到与这条 AI 回复对应的用户输入。' });
          ndjson.end();
          return;
        }

        const historyBeforeParentUser = parentUserMessage.parent_message_id
          ? buildPathMessages(allMessages, parentUserMessage.parent_message_id)
          : [];

        const newUserMessageId = await addMessage({
          conversationId,
          senderType: 'user',
          content: parentUserMessage.content,
          parentMessageId: parentUserMessage.parent_message_id || null,
          branchFromMessageId: parentUserMessage.id,
          editedFromMessageId: parentUserMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'user-replay-copy-for-ai',
            sourceMessageId: parentUserMessage.id,
            delivery: 'stream',
          }),
        });

        previewUserContent = parentUserMessage.content;
        const userPacket = await buildChatMessagePacket(req, conversation, await listMessages(conversationId), newUserMessageId, newUserMessageId);
        ndjson.safeWrite({ type: 'user-message', conversationId, userMessageId: newUserMessageId, content: previewUserContent, leafId: newUserMessageId, mode: 'replay', html: userPacket ? userPacket.html : '' });
        ndjson.safeWrite({ type: 'assistant-start', conversationId, parentMessageId: newUserMessageId, sourceMessageId: messageId, mode: 'replay' });

        reply = await streamChatReplyToNdjson({
          requestId: req.requestId,
          userId: req.session.user.id,
          conversationId,
          character: buildConversationCharacterPayload(conversation),
          messages: historyBeforeParentUser,
          userMessage: parentUserMessage.content,
          systemHint: '这是一次从旧 AI 节点开始的后续重算，请给出与旧回复不同但同样合理的新走向。',
          promptKind: 'replay',
          modelMode: conversation.selected_model_mode || 'standard',
          signal: ndjson.abortController.signal,
          safeWrite: ndjson.safeWrite,
          user: req.session.user,
        });

        if (ndjson.isClosed() || ndjson.abortController.signal.aborted) {
          return;
        }

        newLeafId = await addMessage({
          conversationId,
          senderType: 'character',
          content: reply,
          parentMessageId: newUserMessageId,
          branchFromMessageId: newUserMessageId,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'assistant-replay-after-ai-stream',
            sourceMessageId: messageId,
          }),
        });
      }

      await invalidateConversationCache(conversationId);
      const messagesWithReply = await listMessages(conversationId);
      const replyPacket = await buildChatMessagePacket(req, conversation, messagesWithReply, newLeafId, newLeafId);
      const newLeafMessage = messagesWithReply.find((message) => Number(message.id) === Number(newLeafId));
      const parentPacket = newLeafMessage && newLeafMessage.parent_message_id
        ? await buildChatMessagePacket(req, conversation, messagesWithReply, newLeafId, newLeafMessage.parent_message_id)
        : null;
      ndjson.safeWrite({
        type: 'done',
        conversationId,
        replyMessageId: newLeafId,
        leafId: newLeafId,
        full: reply,
        mode: 'replay',
        html: replyPacket ? replyPacket.html : '',
        parentMessageId: newLeafMessage ? newLeafMessage.parent_message_id : null,
        parentHtml: parentPacket ? parentPacket.html : '',
        preview: [
          { role: '你', content: previewUserContent },
          { role: conversation.character_name, content: reply },
        ],
      });
      ndjson.end();
    } catch (error) {
      if (!res.headersSent) {
        return next(error);
      }
      ndjson.fail(error);
    }
  });

  app.post('/chat/:conversationId/messages/:messageId/replay', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage) {
        return renderPage(res, 'message', { title: '提示', message: '重算起点不存在。' });
      }
      if (!targetMessage.parent_message_id) {
        return renderPage(res, 'message', { title: '提示', message: '根节点不适合做后续重算。' });
      }

      const allMessages = await listMessages(conversationId);
      const historyBeforeTarget = buildPathMessages(allMessages, targetMessage.parent_message_id);
      let newLeafId = null;
      let regeneratedPreview = [];

      if (targetMessage.sender_type === 'user') {
        const newUserMessageId = await addMessage({
          conversationId,
          senderType: 'user',
          content: targetMessage.content,
          parentMessageId: targetMessage.parent_message_id || null,
          branchFromMessageId: targetMessage.id,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'user-replay-branch',
            sourceMessageId: messageId,
          }),
        });

        const reply = await generateReplyViaGateway({
          requestId: req.requestId,
          userId: req.session.user.id,
          conversationId,
          character: buildConversationCharacterPayload(conversation),
          messages: historyBeforeTarget,
          userMessage: targetMessage.content,
          systemHint: '这是一次从旧节点开始的后续重算，请自然延续并给出新的合理走向。',
          promptKind: 'replay',
          modelMode: conversation.selected_model_mode || 'standard',
          user: req.session.user,
        });

        newLeafId = await addMessage({
          conversationId,
          senderType: 'character',
          content: reply,
          parentMessageId: newUserMessageId,
          branchFromMessageId: newUserMessageId,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'assistant-replay-after-user',
            sourceMessageId: messageId,
          }),
        });

        regeneratedPreview = [
          { role: '你', content: targetMessage.content },
          { role: conversation.character_name, content: reply },
        ];
      } else {
        const parentUserMessage = await getMessageById(conversationId, targetMessage.parent_message_id);
        if (!parentUserMessage || parentUserMessage.sender_type !== 'user') {
          return renderPage(res, 'message', { title: '提示', message: '找不到与这条 AI 回复对应的用户输入。' });
        }

        const historyBeforeParentUser = parentUserMessage.parent_message_id
          ? buildPathMessages(allMessages, parentUserMessage.parent_message_id)
          : [];

        const newUserMessageId = await addMessage({
          conversationId,
          senderType: 'user',
          content: parentUserMessage.content,
          parentMessageId: parentUserMessage.parent_message_id || null,
          branchFromMessageId: parentUserMessage.id,
          editedFromMessageId: parentUserMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'user-replay-copy-for-ai',
            sourceMessageId: parentUserMessage.id,
          }),
        });

        const reply = await generateReplyViaGateway({
          requestId: req.requestId,
          userId: req.session.user.id,
          conversationId,
          character: buildConversationCharacterPayload(conversation),
          messages: historyBeforeParentUser,
          userMessage: parentUserMessage.content,
          systemHint: '这是一次从旧 AI 节点开始的后续重算，请给出与旧回复不同但同样合理的新走向。',
          promptKind: 'replay',
          modelMode: conversation.selected_model_mode || 'standard',
          user: req.session.user,
        });

        newLeafId = await addMessage({
          conversationId,
          senderType: 'character',
          content: reply,
          parentMessageId: newUserMessageId,
          branchFromMessageId: newUserMessageId,
          editedFromMessageId: targetMessage.id,
          promptKind: 'replay',
          metadataJson: JSON.stringify({
            requestId: req.requestId,
            operation: 'assistant-replay-after-ai',
            sourceMessageId: messageId,
          }),
        });

        regeneratedPreview = [
          { role: '你', content: parentUserMessage.content },
          { role: conversation.character_name, content: reply },
        ];
      }

      await renderChatPage(req, res, conversation, {
        leafId: newLeafId,
        regeneratedPreview,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/model', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const selectedModelMode = String(req.body.modelMode || 'standard').trim();
      if (!['standard', 'jailbreak', 'force_jailbreak'].includes(selectedModelMode)) {
        return renderPage(res, 'message', { title: '提示', message: '模型模式不支持。' });
      }

      await updateConversationModelMode(conversationId, selectedModelMode);
      return res.redirect(`/chat/${conversationId}?leaf=${conversation.current_message_id || ''}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/optimize-input/stream', requireAuth, async (req, res, next) => {
    const ndjson = createNdjsonResponder(req, res);
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const content = String(req.body.content || '').trim();
      const parentMessageId = parseIntegerField(req.body.parentMessageId, { fieldLabel: '父消息 ID', min: 1, allowEmpty: true });
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        ndjson.end();
        return;
      }
      if (!content) {
        ndjson.safeWrite({ type: 'error', message: '内容不能为空。' });
        ndjson.end();
        return;
      }

      const allMessages = await listMessages(conversationId);
      const history = buildPathMessages(allMessages, parentMessageId || conversation.current_message_id || null);
      ndjson.safeWrite({
        type: 'assistant-start',
        conversationId,
        parentMessageId: parentMessageId || conversation.current_message_id || null,
        mode: 'optimize-input',
      });

      const optimizedContent = await streamOptimizedInputToNdjson({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: buildConversationCharacterPayload(conversation),
        messages: history,
        userInput: content,
        modelMode: conversation.selected_model_mode || 'standard',
        signal: ndjson.abortController.signal,
        safeWrite: ndjson.safeWrite,
        user: req.session.user,
      });

      if (ndjson.isClosed() || ndjson.abortController.signal.aborted) {
        return;
      }

      ndjson.safeWrite({
        type: 'done',
        conversationId,
        leafId: parentMessageId || conversation.current_message_id || null,
        full: optimizedContent,
        mode: 'optimize-input',
        draftContent: content,
        optimizedContent,
      });
      ndjson.end();
    } catch (error) {
      if (!res.headersSent) {
        return next(error);
      }
      ndjson.fail(error);
    }
  });

  app.post('/chat/:conversationId/optimize-input', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const content = String(req.body.content || '').trim();
      const parentMessageId = parseIntegerField(req.body.parentMessageId, { fieldLabel: '父消息 ID', min: 1, allowEmpty: true });
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }
      if (!content) {
        return renderPage(res, 'message', { title: '提示', message: '内容不能为空。' });
      }

      const allMessages = await listMessages(conversationId);
      const history = buildPathMessages(allMessages, parentMessageId || conversation.current_message_id || null);
      const optimizedContent = await optimizeUserInputViaGateway({
        requestId: req.requestId,
        userId: req.session.user.id,
        conversationId,
        character: buildConversationCharacterPayload(conversation),
        messages: history,
        userInput: content,
        modelMode: conversation.selected_model_mode || 'standard',
        user: req.session.user,
      });

      await renderChatPage(req, res, conversation, {
        leafId: parentMessageId || conversation.current_message_id || null,
        draftContent: content,
        optimizedContent,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/branch/:messageId', requireAuth, async (req, res, next) => {
    try {
      const conversationId = parseIdParam(req.params.conversationId, '会话 ID');
      const messageId = parseIdParam(req.params.messageId, '消息 ID');
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const allMessages = await listMessages(conversation.id);
      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage) {
        return renderPage(res, 'message', { title: '提示', message: '分支起点不存在。' });
      }
      const view = buildConversationView(allMessages, messageId);

      const branchTitle = view.currentBranch
        ? buildBranchConversationTitle(conversation, view.currentBranch.label, view.currentBranch.summary)
        : buildConversationTitle(conversation.character_name, targetMessage.content);
      const branchResult = await cloneConversationBranch({
        userId: req.session.user.id,
        characterId: conversation.character_id,
        sourceConversationId: conversation.id,
        sourceLeafMessageId: messageId,
        selectedModelMode: conversation.selected_model_mode || 'standard',
        title: branchTitle,
      });

      return res.redirect(`/chat/${branchResult.conversationId}?leaf=${branchResult.leafMessageId}`);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerWebRoutes };
