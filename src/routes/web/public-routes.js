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
    listFeaturedPublicCharacters,
    toggleCharacterLike,
    addCharacterComment,
    listCharacterComments,
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
    parseIdParam,
    getClientIp,
    hitLimit
  } = ctx;

  function getSameOriginBackUrl(req, fallback = '/characters/public') {
    const referer = String(req.get('referer') || '').trim();
    if (!referer) return fallback;
    try {
      const parsed = new URL(referer, `${req.protocol}://${req.get('host')}`);
      if (parsed.host === req.get('host')) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch (_) {}
    return fallback;
  }

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
      const characters = await listFeaturedPublicCharacters(6);
      renderPage(res, 'home', {
        title: '首页',
        characters,
        meta: {
          url: '/',
          description: t('楼阁默认分享描述'),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/characters/public', async (req, res, next) => {
    try {
      const page = Number.parseInt(req.query.page || '1', 10);
      const pageSize = Number.parseInt(req.query.pageSize || '12', 10);
      const keyword = String(req.query.q || '').trim();
      const sort = ['newest', 'oldest', 'likes', 'comments', 'usage', 'heat', 'random'].includes(String(req.query.sort || '').trim())
        ? String(req.query.sort || '').trim()
        : 'heat';
      const result = await listPublicCharacters({ page, pageSize, keyword, sort });
      const commentsByCharacter = {};
      await Promise.all(result.characters.map(async (character) => {
        commentsByCharacter[character.id] = await listCharacterComments(character.id, 3);
      }));
      renderPage(res, 'public-characters', {
        title: '公开角色',
        characters: result.characters,
        pagination: result.pagination,
        filters: result.filters,
        commentsByCharacter,
        meta: {
          url: `/characters/public${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`,
          description: keyword
            ? `在楼阁搜索「${keyword}」相关的公开角色，按热度、点赞、评论或使用量筛选。`
            : '浏览楼阁公开角色，按综合热度、点赞、评论或使用量筛选，找到适合开聊的人设。',
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/characters/public/:characterId/like', async (req, res, next) => {
    try {
      if (!req.session?.user?.id) {
        return res.redirect('/login');
      }
      const characterId = parseIdParam(req.params.characterId, '角色 ID');
      const limited = await hitLimit(`rate:character-like:${req.session.user.id}`, 60, 60);
      if (limited) {
        return res.status(429).send('too many requests');
      }
      await toggleCharacterLike(characterId, req.session.user.id);
      return res.redirect(getSameOriginBackUrl(req, '/characters/public'));
    } catch (error) {
      next(error);
    }
  });

  app.post('/characters/public/:characterId/comments', async (req, res, next) => {
    try {
      if (!req.session?.user?.id) {
        return res.redirect('/login');
      }
      const characterId = parseIdParam(req.params.characterId, '角色 ID');
      const limited = await hitLimit(`rate:character-comment:${req.session.user.id}:${getClientIp(req)}`, 60, 12);
      if (limited) {
        return res.status(429).send('too many requests');
      }
      await addCharacterComment(characterId, req.session.user.id, req.body.commentBody);
      return res.redirect(getSameOriginBackUrl(req, '/characters/public'));
    } catch (error) {
      if (error.code === 'COMMENT_EMPTY') {
        return res.redirect(getSameOriginBackUrl(req, '/characters/public'));
      }
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
