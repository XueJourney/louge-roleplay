/**
 * @file src/routes/web/auth/register-routes.js
 * @description 用户注册提交路由，包含地区、邮箱/手机验证码和默认登录态建立。
 */

function registerAuthRegisterRoutes(app, ctx) {
  const {
    createCaptcha,
    createUser,
    findUserByUsername,
    findUserByEmail,
    findUserByPhone,
    findUserById,
    issueEmailCode,
    issuePhoneCode,
    verifyEmailCode,
    verifyPhoneCode,
    hashPassword,
    hitLimit,
    logger,
    renderRegisterPage,
    getClientIp,
    buildRegisterLogMeta,
    isEmail,
    isAllowedInternationalEmail,
    isDomesticPhone,
  } = ctx;

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
      if (username.length < 1 || password.length < 6) {
        return renderRegisterError('用户名不能为空，密码至少 6 位。', 'USERNAME_OR_PASSWORD_TOO_SHORT');
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
      req.session.user = { id: userId, publicId: null, username, role: 'user' };
      const registeredUser = await findUserById(userId);
      req.session.user.publicId = registeredUser?.public_id || null;
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

}

module.exports = { registerAuthRegisterRoutes };
