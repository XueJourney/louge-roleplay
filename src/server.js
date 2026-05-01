/**
 * @file src/server.js
 * @description
 * Web 应用启动壳：只负责创建 Express、装配全局中间件、注册路由并启动监听。
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
const { csrfProtection } = require('./middleware/csrf');
const { appendDailyLog } = require('./services/log-service');
const { recoverInterruptedLlmJobs } = require('./services/llm-usage-service');
const { waitReady: waitDbReady, getDbType } = require('./lib/db');
const { initRedis, redisClient, isRedisReal } = require('./lib/redis');
const { requestContext } = require('./middleware/request-context');
const { attachI18n } = require('./middleware/i18n');
const { errorHandler } = require('./middleware/error-handler');
const { renderPage } = require('./server-helpers');
const { registerWebRoutes } = require('./routes/web-routes');

const app = express();
let server;

function shutdown(signal) {
  logger.warn('Application shutdown requested', { signal });
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed', { signal });
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced shutdown after timeout', { signal });
      process.exit(1);
    }, 10000).unref();
    return;
  }
  process.exit(0);
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception; exiting process', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function buildCspDirectives() {
  const nonceValue = (req, res) => `'nonce-${res.locals.cspNonce}'`;
  let appOrigin = "'self'";
  try {
    appOrigin = config.appUrl ? new URL(config.appUrl).origin : "'self'";
  } catch (_) {
    appOrigin = "'self'";
  }
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'"],
    formAction: ["'self'"],
    scriptSrc: ["'self'", nonceValue],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    styleSrcAttr: ["'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https://api.qrserver.com'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", appOrigin],
    mediaSrc: ["'self'", 'blob:', 'data:'],
    workerSrc: ["'self'", 'blob:'],
    upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
  };
}

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && config.productionFailFast) {
    if (config.sessionSecretIsEphemeral) {
      throw new Error('SESSION_SECRET is required in production');
    }
    if (!config.cookieSecure) {
      throw new Error('COOKIE_SECURE=true is required in production');
    }
  }

  await waitDbReady();
  logger.info('[bootstrap] 数据库已就绪', { dbType: getDbType() });

  const recoveredJobCount = await recoverInterruptedLlmJobs();
  if (recoveredJobCount > 0) {
    logger.warn('[bootstrap] 已恢复上次进程遗留的 LLM 队列任务', { recoveredJobCount });
  }

  await initRedis();
  logger.info('[bootstrap] Redis 初始化完成', { mode: isRedisReal() ? '真实 Redis' : '内存替代' });

  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use('/public', express.static(path.join(__dirname, '..', 'public')));
  app.use(compression({
    filter: (req, res) => {
      const contentType = String(res.getHeader('Content-Type') || '').toLowerCase();
      if (contentType.includes('application/x-ndjson')) {
        return false;
      }
      return compression.filter(req, res);
    },
  }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(express.json({ limit: '20kb' }));
  app.use(morgan('combined', {
    stream: {
      write(line) {
        appendDailyLog('access', String(line || '').trimEnd());
        process.stdout.write(line);
      },
    },
  }));

  const sessionStore = isRedisReal()
    ? new RedisStore({ client: redisClient })
    : undefined;

  if (!isRedisReal()) {
    logger.warn('[bootstrap] Session 使用内存存储（重启后登录状态清空，不适合生产）');
  }

  app.use(session({
    store: sessionStore,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'louge.sid',
    cookie: {
      httpOnly: true,
      secure: config.cookieSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  }));

  app.use(requestContext);
  app.use(csrfProtection);
  app.use(attachI18n);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: buildCspDirectives(),
    },
  }));
  registerWebRoutes(app);

  app.use((req, res) => {
    res.status(404);
    renderPage(res, 'error', {
      title: req.t('页面不存在'),
      message: req.t('找不到 {path}，请确认地址是否正确。', { path: req.path }),
      errorCode: 'NOT_FOUND',
      requestId: req.requestId,
    });
  });

  app.use(errorHandler);

  server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('Application started successfully', {
      ...config.getPrivacySafeSummary(),
      debugFeatures: [
        'requestId logging',
        'linear chat loading',
        'linear chat UX',
        'assistant rewrites',
      ],
    });
  });
}

bootstrap().catch((error) => {
  logger.error('Application bootstrap failed', { error: error.message, stack: error.stack });
  process.exit(1);
});
