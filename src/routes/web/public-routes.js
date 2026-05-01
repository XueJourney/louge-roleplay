/**
 * @file src/routes/web/public-routes.js
 * @description 从 web-routes.js 拆出的路由分组。
 */

function registerPublicRoutes(app, ctx) {
  const {
    createCaptcha,
    refreshCaptcha,
    getCaptchaImage,
    listPublicCharacters,
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
    renderRegisterPage
  } = ctx;

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
      version: config.appVersion,
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
}

module.exports = { registerPublicRoutes };
