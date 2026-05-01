/**
 * @file src/routes/web/auth-routes.js
 * @description 从 web-routes.js 拆出的路由分组。
 */

function registerAuthRoutes(app, ctx) {
  const {
    requireAuth,
    createCaptcha,
    verifyCaptcha,
    createUser,
    findUserByUsername,
    findUserByEmail,
    findUserByPhone,
    findUserByLogin,
    findUserById,
    findUserAuthById,
    updateUsername,
    updatePasswordHash,
    listUserCharacters,
    getActiveSubscriptionForUser,
    getUserQuotaSnapshot,
    listUserConversations,
    issueEmailCode,
    issuePhoneCode,
    verifyEmailCode,
    verifyPhoneCode,
    hashPassword,
    verifyPassword,
    verifyDomesticPhoneIdentity,
    hitLimit,
    logger,
    renderPage,
    renderRegisterPage,
    getClientIp,
    buildRegisterLogMeta,
    buildLoginLogMeta,
    isEmail,
    isAllowedInternationalEmail,
    isDomesticPhone
  } = ctx;

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
}

module.exports = { registerAuthRoutes };
