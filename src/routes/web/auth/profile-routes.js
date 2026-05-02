/**
 * @file src/routes/web/auth/profile-routes.js
 * @description 个人资料维护路由，支持用户名、邮箱、手机和密码变更。
 */

function registerAuthProfileRoutes(app, ctx) {
  const {
    requireAuth,
    createCaptcha,
    findUserByUsername,
    findUserByEmail,
    findUserByPhone,
    findUserById,
    findUserAuthById,
    updateUsername,
    updatePasswordHash,
    updateUserEmail,
    unbindUserEmail,
    updateUserPhone,
    unbindUserPhone,
    updateUserNsfwPreference,
    updateUserReplyLengthPreference,
    verifyEmailCode,
    verifyPhoneCode,
    hashPassword,
    verifyPassword,
    renderPage,
    isEmail,
    isDomesticPhone,
  } = ctx;

  app.get('/profile', requireAuth, async (req, res, next) => {
    try {
      const user = await findUserById(req.session.user.id);
      if (!user) {
        return req.session.destroy(() => res.redirect('/login'));
      }
      const nextCaptcha = await createCaptcha();
      renderPage(res, 'profile', {
        title: '个人资料',
        user,
        captcha: nextCaptcha,
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

      const renderProfileMessage = async (message, status = 'error', targetUser = user) => renderPage(res, 'profile', {
        title: '个人资料',
        user: targetUser,
        captcha: await createCaptcha(),
        formMessage: message,
        formStatus: status,
      });

      if (action === 'username') {
        const username = String(req.body.username || '').trim();
        if (!username) {
          return await renderProfileMessage('用户名不能为空。');
        }
        if (username.length > 50) {
          return await renderProfileMessage('用户名不能超过 50 位。');
        }
        if (username === user.username) {
          return await renderProfileMessage('新用户名和当前用户名一样，就别折腾啦。', 'info');
        }

        const existedUser = await findUserByUsername(username);
        if (existedUser && Number(existedUser.id) !== Number(userId)) {
          return await renderProfileMessage('这个用户名已经有人用了。');
        }

        await updateUsername(userId, username);
        req.session.user.username = username;
        const refreshedUser = await findUserById(userId);
        return await renderProfileMessage('用户名改好了。', 'success', refreshedUser);
      }

      if (action === 'email') {
        const email = String(req.body.email || '').trim().toLowerCase();
        const emailCode = String(req.body.emailCode || '').trim();

        if (!email || !isEmail(email)) {
          return await renderProfileMessage('请输入有效邮箱。');
        }
        const existedUser = await findUserByEmail(email);
        if (existedUser && Number(existedUser.id) !== Number(userId)) {
          return await renderProfileMessage('这个邮箱已经被绑定了。');
        }
        if (email === String(user.email || '').toLowerCase()) {
          return await renderProfileMessage('这个邮箱已经在当前账号上。', 'info');
        }
        const emailOk = await verifyEmailCode(email, emailCode);
        if (!emailOk) {
          return await renderProfileMessage('邮箱验证码错误或已失效。');
        }

        await updateUserEmail(userId, email, 1);
        const refreshedUser = await findUserById(userId);
        return await renderProfileMessage(user.email ? '邮箱已经切换好了。' : '邮箱已经绑定好了。', 'success', refreshedUser);
      }

      if (action === 'unbindEmail') {
        if (!user.email) {
          return await renderProfileMessage('当前没有绑定邮箱。', 'info');
        }
        await unbindUserEmail(userId);
        const refreshedUser = await findUserById(userId);
        return await renderProfileMessage('邮箱已经解绑。', 'success', refreshedUser);
      }

      if (action === 'phone') {
        const phone = String(req.body.phone || '').trim();
        const phoneCode = String(req.body.phoneCode || '').trim();

        if (!phone || !isDomesticPhone(phone)) {
          return await renderProfileMessage('请输入正确的国内手机号。');
        }
        const existedUser = await findUserByPhone(phone);
        if (existedUser && Number(existedUser.id) !== Number(userId)) {
          return await renderProfileMessage('这个手机号已经被绑定了。');
        }
        if (phone === String(user.phone || '')) {
          return await renderProfileMessage('这个手机号已经在当前账号上。', 'info');
        }
        const phoneOk = await verifyPhoneCode(phone, phoneCode);
        if (!phoneOk) {
          return await renderProfileMessage('短信验证码错误或已失效。');
        }

        await updateUserPhone(userId, phone, 1);
        const refreshedUser = await findUserById(userId);
        return await renderProfileMessage(user.phone ? '手机号已经切换好了。' : '手机号已经绑定好了。', 'success', refreshedUser);
      }

      if (action === 'unbindPhone') {
        if (!user.phone) {
          return await renderProfileMessage('当前没有绑定手机号。', 'info');
        }
        await unbindUserPhone(userId);
        const refreshedUser = await findUserById(userId);
        return await renderProfileMessage('手机号已经解绑。', 'success', refreshedUser);
      }

      if (action === 'privacy') {
        const showNsfw = String(req.body.showNsfw || '').trim() === '1';
        await updateUserNsfwPreference(userId, showNsfw);
        req.session.user.show_nsfw = showNsfw ? 1 : 0;
        const refreshedUser = await findUserById(userId);
        return await renderProfileMessage(showNsfw ? 'NSFW 角色显示已开启。' : 'NSFW 角色显示已关闭，公共角色大厅会默认隐藏。', 'success', refreshedUser);
      }

      if (action === 'replyLength') {
        const preference = String(req.body.replyLengthPreference || '').trim();
        if (!['low', 'medium', 'high'].includes(preference)) {
          return await renderProfileMessage('请选择有效的回复长度。');
        }
        await updateUserReplyLengthPreference(userId, preference);
        req.session.user.reply_length_preference = preference;
        const refreshedUser = await findUserById(userId);
        const messageMap = {
          low: '回复长度已设为简洁：之后会更克制地回复，同时保留关键信息。',
          medium: '回复长度已设为适中：之后不额外加入长度约束。',
          high: '回复长度已设为详细：之后会更充分展开，尽力补足细节与推演。',
        };
        return await renderProfileMessage(messageMap[preference], 'success', refreshedUser);
      }

      if (action === 'password') {
        const currentPassword = String(req.body.currentPassword || '').trim();
        const newPassword = String(req.body.newPassword || '').trim();
        const confirmPassword = String(req.body.confirmPassword || '').trim();

        if (!currentPassword || !newPassword || !confirmPassword) {
          return await renderProfileMessage('改密码这几项得填完整。');
        }
        if (newPassword.length < 6) {
          return await renderProfileMessage('新密码至少 6 位。');
        }
        if (newPassword !== confirmPassword) {
          return await renderProfileMessage('两次输入的新密码不一致。');
        }

        const authUser = await findUserAuthById(userId);
        if (!authUser) {
          return req.session.destroy(() => res.redirect('/login'));
        }

        const isValidPassword = await verifyPassword(currentPassword, authUser.password_hash);
        if (!isValidPassword) {
          return await renderProfileMessage('当前密码不对。');
        }

        const isSamePassword = await verifyPassword(newPassword, authUser.password_hash);
        if (isSamePassword) {
          return await renderProfileMessage('新密码不能和现在这个一样。', 'info');
        }

        const passwordHash = await hashPassword(newPassword);
        await updatePasswordHash(userId, passwordHash);
        const refreshedUser = await findUserById(userId);
        return await renderProfileMessage('密码已经更新好了。', 'success', refreshedUser);
      }

      return await renderProfileMessage('不认识这个资料操作。');
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerAuthProfileRoutes };
