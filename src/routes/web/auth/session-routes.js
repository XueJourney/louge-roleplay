/**
 * @file src/routes/web/auth/session-routes.js
 * @description 登录、登出路由，包含 IP 限流和失败原因脱敏日志。
 */

function registerAuthSessionRoutes(app, ctx) {
  const {
    findUserByLogin,
    verifyPassword,
    hitLimit,
    logger,
    renderPage,
    getClientIp,
    buildLoginLogMeta,
  } = ctx;

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
      req.session.user = { id: user.id, publicId: user.public_id || null, username: user.username, role: user.role || 'user' };
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

  app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

}

module.exports = { registerAuthSessionRoutes };
