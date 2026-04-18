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
const { initRedis, redisClient } = require('./lib/redis');
const { requestContext } = require('./middleware/request-context');
const { errorHandler } = require('./middleware/error-handler');
const { requireAuth } = require('./middleware/auth');
const { hashPassword, verifyPassword } = require('./services/password-service');
const { createUser, findUserByUsername, findUserByEmail, findUserByPhone, findUserByLogin, findUserById } = require('./services/user-service');
const { createCharacter, listPublicCharacters, listUserCharacters, getCharacterById } = require('./services/character-service');
const {
  createConversation,
  updateConversationTitle,
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
} = require('./services/conversation-service');
const { generateReply, optimizeUserInput } = require('./services/ai-service');
const { createCaptcha, getCaptchaImage, verifyCaptcha } = require('./services/captcha-service');
const { issueEmailCode, issuePhoneCode, verifyEmailCode, verifyPhoneCode } = require('./services/verification-service');
const { verifyDomesticPhoneIdentity } = require('./services/phone-auth-service');
const { hitLimit } = require('./services/rate-limit-service');

const app = express();

function renderPage(res, view, params = {}) {
  res.render(view, params, (error, html) => {
    if (error) {
      throw error;
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

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
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

  renderPage(res, 'chat', {
    title: '聊天',
    conversation,
    view,
    draftContent: options.draftContent || String(req.query.draft || ''),
    optimizedContent: options.optimizedContent || '',
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

async function bootstrap() {
  await initRedis();

  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use('/public', express.static(path.join(__dirname, '..', 'public')));

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(express.json({ limit: '20kb' }));
  app.use(morgan('combined'));

  app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.cookieSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  }));

  app.use(requestContext);

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
      renderPage(res, 'register', {
        title: '注册',
        captcha,
        authConfig: {
          graphAuthAppId: config.aliyunPhoneAuthAppId,
          graphAuthAppKey: config.aliyunPhoneAuthAppKey,
          numberAuthSchemeCode: config.aliyunNumberAuthSchemeCode,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/captcha', async (req, res, next) => {
    try {
      const captcha = await createCaptcha();
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

  app.post('/api/send-email-code', async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const email = String(req.body.email || '').trim().toLowerCase();
      const countryType = String(req.body.countryType || 'international').trim();
      if (!isEmail(email)) {
        return res.status(400).json({ message: '邮箱格式不正确' });
      }
      if (countryType === 'international' && !isAllowedInternationalEmail(email)) {
        return res.status(400).json({ message: '海外用户仅支持 Gmail、Outlook、Hotmail、Live、iCloud、Yahoo、AOL、Proton 等主流邮箱' });
      }
      if (await findUserByEmail(email)) {
        return res.status(400).json({ message: '邮箱已被注册' });
      }
      await issueEmailCode(email, ip);
      return res.json({ message: '邮箱验证码已发送' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/send-phone-code', async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const phone = String(req.body.phone || '').trim();
      const captchaId = String(req.body.captchaId || '').trim();
      const captchaText = String(req.body.captchaText || '').trim();

      if (!isDomesticPhone(phone)) {
        return res.status(400).json({ message: '请输入正确的国内手机号' });
      }
      if (await findUserByPhone(phone)) {
        return res.status(400).json({ message: '手机号已被注册' });
      }

      const captchaPassed = await verifyCaptcha(captchaId, captchaText, true);
      if (!captchaPassed) {
        return res.status(400).json({ message: '图形验证码错误或已失效' });
      }

      await verifyDomesticPhoneIdentity({ phone, captchaPassed });
      await issuePhoneCode(phone, ip);
      logger.debug('Phone verification code issued', {
        requestId: req.requestId,
        phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
        provider: 'aliyun-sms',
      });
      return res.json({ message: '短信验证码已发送' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/register', async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const limited = await hitLimit(`rate:register:${ip}`, 60, 10);
      if (limited) {
        return renderPage(res, 'message', { title: '提示', message: '注册请求太频繁，请稍后再试。' });
      }

      const username = String(req.body.username || '').trim();
      const password = String(req.body.password || '').trim();
      const countryType = String(req.body.countryType || 'domestic').trim();
      const email = String(req.body.email || '').trim().toLowerCase() || null;
      const emailCode = String(req.body.emailCode || '').trim();
      const phone = String(req.body.phone || '').trim() || null;
      const phoneCode = String(req.body.phoneCode || '').trim();

      if (username.length < 3 || password.length < 6) {
        return renderPage(res, 'message', { title: '提示', message: '用户名至少 3 位，密码至少 6 位。' });
      }

      const existingUser = await findUserByUsername(username);
      if (existingUser) {
        return renderPage(res, 'message', { title: '提示', message: '用户名已存在。' });
      }

      let emailVerified = 0;
      let phoneVerified = 0;

      if (countryType === 'domestic') {
        if (!phone || !isDomesticPhone(phone)) {
          return renderPage(res, 'message', { title: '提示', message: '国内用户必须填写正确手机号。' });
        }
        if (await findUserByPhone(phone)) {
          return renderPage(res, 'message', { title: '提示', message: '手机号已被注册。' });
        }
        const phoneOk = await verifyPhoneCode(phone, phoneCode);
        if (!phoneOk) {
          return renderPage(res, 'message', { title: '提示', message: '短信验证码错误或已失效。' });
        }
        phoneVerified = 1;

        if (email) {
          if (!isEmail(email)) {
            return renderPage(res, 'message', { title: '提示', message: '邮箱格式不正确。' });
          }
          if (await findUserByEmail(email)) {
            return renderPage(res, 'message', { title: '提示', message: '邮箱已被注册。' });
          }
          const emailOk = await verifyEmailCode(email, emailCode);
          if (!emailOk) {
            return renderPage(res, 'message', { title: '提示', message: '邮箱验证码错误或已失效。' });
          }
          emailVerified = 1;
        }
      } else {
        if (!email || !isEmail(email)) {
          return renderPage(res, 'message', { title: '提示', message: '国外用户必须填写有效邮箱。' });
        }
        if (!isAllowedInternationalEmail(email)) {
          return renderPage(res, 'message', { title: '提示', message: '海外用户仅支持 Gmail、Outlook、Hotmail、Live、iCloud、Yahoo、AOL、Proton 等主流邮箱。' });
        }
        if (await findUserByEmail(email)) {
          return renderPage(res, 'message', { title: '提示', message: '邮箱已被注册。' });
        }
        const emailOk = await verifyEmailCode(email, emailCode);
        if (!emailOk) {
          return renderPage(res, 'message', { title: '提示', message: '邮箱验证码错误或已失效。' });
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
      req.session.user = { id: userId, username };
      return res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  });

  app.get('/login', (req, res) => renderPage(res, 'login', { title: '登录' }));
  app.post('/login', async (req, res, next) => {
    try {
      const login = String(req.body.login || '').trim();
      const password = String(req.body.password || '').trim();
      const user = await findUserByLogin(login);

      if (!user) {
        return renderPage(res, 'message', { title: '提示', message: '账号或密码错误。' });
      }

      const isValidPassword = await verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        return renderPage(res, 'message', { title: '提示', message: '账号或密码错误。' });
      }

      req.session.user = { id: user.id, username: user.username };
      return res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  app.get('/dashboard', requireAuth, async (req, res, next) => {
    try {
      const user = await findUserById(req.session.user.id);
      const characters = await listUserCharacters(req.session.user.id);
      const conversations = await listUserConversations(req.session.user.id);
      renderPage(res, 'dashboard', { title: '控制台', user, characters, conversations });
    } catch (error) {
      next(error);
    }
  });

  app.get('/characters/new', requireAuth, (req, res) => {
    renderPage(res, 'character-new', { title: '创建角色' });
  });

  app.post('/characters/new', requireAuth, async (req, res, next) => {
    try {
      const payload = {
        name: String(req.body.name || '').trim(),
        summary: String(req.body.summary || '').trim(),
        personality: String(req.body.personality || '').trim(),
        firstMessage: String(req.body.firstMessage || '').trim(),
      };

      if (!payload.name || !payload.summary || !payload.personality || !payload.firstMessage) {
        return renderPage(res, 'message', { title: '提示', message: '角色信息不能为空。' });
      }

      await createCharacter(req.session.user.id, payload);
      return res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  });

  app.post('/conversations/start/:characterId', requireAuth, async (req, res, next) => {
    try {
      const characterId = Number(req.params.characterId);
      const character = await getCharacterById(characterId);

      if (!character) {
        return renderPage(res, 'message', { title: '提示', message: '角色不存在。' });
      }

      const conversationId = await createConversation(req.session.user.id, characterId, {
        title: `${character.name} · 新对话`,
      });

      let currentParentId = null;
      if (character.first_message) {
        currentParentId = await addMessage({
          conversationId,
          senderType: 'character',
          content: character.first_message,
          promptKind: 'normal',
          metadataJson: JSON.stringify({ source: 'character-first-message' }),
        });
      }

      return res.redirect(`/chat/${conversationId}${currentParentId ? `?leaf=${currentParentId}` : ''}`);
    } catch (error) {
      next(error);
    }
  });

  app.get('/chat/:conversationId', requireAuth, async (req, res, next) => {
    try {
      const conversationId = Number(req.params.conversationId);
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      await renderChatPage(req, res, conversation);
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/message', requireAuth, async (req, res, next) => {
    try {
      const conversationId = Number(req.params.conversationId);
      const content = String(req.body.content || '').trim();
      const parentMessageId = Number(req.body.parentMessageId || 0) || null;

      if (!content) {
        return renderPage(res, 'message', { title: '提示', message: '消息不能为空。' });
      }

      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const allMessages = await listMessages(conversationId);
      const history = buildPathMessages(allMessages, parentMessageId || conversation.current_message_id || null);
      const isBranchReply = parentMessageId && Number(parentMessageId) !== Number(conversation.current_message_id || 0);

      const userMessageId = await addMessage({
        conversationId,
        senderType: 'user',
        content,
        parentMessageId,
        branchFromMessageId: parentMessageId,
        promptKind: isBranchReply ? 'branch' : 'normal',
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'user-message',
        }),
      });

      const reply = await generateReply({
        character: {
          name: conversation.character_name,
          summary: conversation.character_summary,
          personality: conversation.personality,
        },
        messages: [...history, { sender_type: 'user', content }],
        userMessage: content,
      });

      const replyMessageId = await addMessage({
        conversationId,
        senderType: 'character',
        content: reply,
        parentMessageId: userMessageId,
        branchFromMessageId: userMessageId,
        promptKind: isBranchReply ? 'branch' : 'normal',
        metadataJson: JSON.stringify({
          requestId: req.requestId,
          operation: 'assistant-reply',
        }),
      });

      await updateConversationTitle(conversationId, buildNextConversationTitle(conversation, content));
      return res.redirect(`/chat/${conversationId}?leaf=${replyMessageId}`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/chat/:conversationId/regenerate/:messageId', requireAuth, async (req, res, next) => {
    try {
      const conversationId = Number(req.params.conversationId);
      const messageId = Number(req.params.messageId);
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
      const reply = await generateReply({
        character: {
          name: conversation.character_name,
          summary: conversation.character_summary,
          personality: conversation.personality,
        },
        messages: [...history, parentUserMessage],
        userMessage: parentUserMessage.content,
        systemHint: '这是一次重新生成。请在保持角色一致的前提下，给出与先前不同但同样合理的新回复。',
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

  app.post('/chat/:conversationId/messages/:messageId/edit', requireAuth, async (req, res, next) => {
    try {
      const conversationId = Number(req.params.conversationId);
      const messageId = Number(req.params.messageId);
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

  app.post('/chat/:conversationId/optimize-input', requireAuth, async (req, res, next) => {
    try {
      const conversationId = Number(req.params.conversationId);
      const content = String(req.body.content || '').trim();
      const parentMessageId = Number(req.body.parentMessageId || 0) || null;
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }
      if (!content) {
        return renderPage(res, 'message', { title: '提示', message: '内容不能为空。' });
      }

      const allMessages = await listMessages(conversationId);
      const history = buildPathMessages(allMessages, parentMessageId || conversation.current_message_id || null);
      const optimizedContent = await optimizeUserInput({
        character: {
          name: conversation.character_name,
          summary: conversation.character_summary,
          personality: conversation.personality,
        },
        messages: history,
        userInput: content,
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
      const conversationId = Number(req.params.conversationId);
      const messageId = Number(req.params.messageId);
      const conversation = await loadConversationForUserOrFail(req, res, conversationId);
      if (!conversation) {
        return;
      }

      const targetMessage = await getMessageById(conversationId, messageId);
      if (!targetMessage) {
        return renderPage(res, 'message', { title: '提示', message: '分支起点不存在。' });
      }

      const branchTitle = buildConversationTitle(conversation.character_name, targetMessage.content);
      const branchResult = await cloneConversationBranch({
        userId: req.session.user.id,
        characterId: conversation.character_id,
        sourceConversationId: conversation.id,
        sourceLeafMessageId: messageId,
        title: branchTitle,
      });

      return res.redirect(`/chat/${branchResult.conversationId}?leaf=${branchResult.leafMessageId}`);
    } catch (error) {
      next(error);
    }
  });

  app.use(errorHandler);

  app.listen(config.port, '0.0.0.0', () => {
    logger.info('Application started successfully', {
      port: config.port,
      appName: config.appName,
      debugFeatures: [
        'requestId logging',
        'conversation tree cache',
        'branch cloning',
        'assistant variants',
      ],
    });
  });
}

bootstrap().catch((error) => {
  logger.error('Application bootstrap failed', { error: error.message, stack: error.stack });
  process.exit(1);
});
