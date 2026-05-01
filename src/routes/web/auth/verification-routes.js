/**
 * @file src/routes/web/auth/verification-routes.js
 * @description 邮箱/手机验证码发送接口，统一在响应后刷新图形验证码以降低重放风险。
 */

function registerAuthVerificationRoutes(app, ctx) {
  const {
    createCaptcha,
    verifyCaptcha,
    findUserByEmail,
    findUserByPhone,
    issueEmailCode,
    issuePhoneCode,
    verifyDomesticPhoneIdentity,
    hitLimit,
    logger,
    getClientIp,
    isEmail,
    isAllowedInternationalEmail,
    isDomesticPhone,
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
      const limited = await hitLimit(`rate:email-code:${ip}`, 60, 20);
      if (limited) {
        return refreshAndRespond(429, { message: '验证码请求太频繁，请稍后再试。' });
      }
      const email = String(req.body.email || '').trim().toLowerCase();
      const countryType = String(req.body.countryType || 'international').trim();
      const purpose = String(req.body.purpose || 'register').trim();
      const currentUserId = req.session?.user?.id ? Number(req.session.user.id) : null;
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
      const emailOwner = await findUserByEmail(email);
      if (emailOwner && (!currentUserId || Number(emailOwner.id) !== currentUserId || purpose !== 'profile-email')) {
        return refreshAndRespond(400, { message: '邮箱已被注册，请输入新的图形验证码后重试。' });
      }
      if (emailOwner && Number(emailOwner.id) === currentUserId && purpose === 'profile-email') {
        return refreshAndRespond(400, { message: '这个邮箱已经绑定在当前账号上，请换一个邮箱。' });
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
      const limited = await hitLimit(`rate:phone-code:${ip}`, 60, 20);
      if (limited) {
        return refreshAndRespond(429, { message: '验证码请求太频繁，请稍后再试。' });
      }
      const phone = String(req.body.phone || '').trim();
      const purpose = String(req.body.purpose || 'register').trim();
      const currentUserId = req.session?.user?.id ? Number(req.session.user.id) : null;
      const captchaId = String(req.body.captchaId || '').trim();
      const captchaText = String(req.body.captchaText || '').trim();

      if (!isDomesticPhone(phone)) {
        return refreshAndRespond(400, { message: '请输入正确的国内手机号，并输入新的图形验证码后重试。' });
      }
      const phoneOwner = await findUserByPhone(phone);
      if (phoneOwner && (!currentUserId || Number(phoneOwner.id) !== currentUserId || purpose !== 'profile-phone')) {
        return refreshAndRespond(400, { message: '手机号已被注册，请输入新的图形验证码后重试。' });
      }
      if (phoneOwner && Number(phoneOwner.id) === currentUserId && purpose === 'profile-phone') {
        return refreshAndRespond(400, { message: '这个手机号已经绑定在当前账号上，请换一个手机号。' });
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
}

module.exports = { registerAuthVerificationRoutes };
