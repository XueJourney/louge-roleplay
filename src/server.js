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
const { appendDailyLog } = require('./services/log-service');
const { waitReady: waitDbReady, getDbType } = require('./lib/db');
const { initRedis, redisClient, isRedisReal } = require('./lib/redis');
const { requestContext } = require('./middleware/request-context');
const { attachI18n } = require('./middleware/i18n');
const { errorHandler } = require('./middleware/error-handler');
const { renderPage } = require('./server-helpers');
const { registerWebRoutes } = require('./routes/web-routes');

const app = express();

async function bootstrap() {
  await waitDbReady();
  logger.info('[bootstrap] 数据库已就绪', { dbType: getDbType() });

  await initRedis();
  logger.info('[bootstrap] Redis 初始化完成', { mode: isRedisReal() ? '真实 Redis' : '内存替代' });

  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use('/public', express.static(path.join(__dirname, '..', 'public')));
  app.use(helmet({ contentSecurityPolicy: false }));
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
    cookie: {
      httpOnly: true,
      secure: config.cookieSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  }));

  app.use(requestContext);
  app.use(attachI18n);
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

  app.listen(config.port, '0.0.0.0', () => {
    logger.info('Application started successfully', {
      port: config.port,
      appName: config.appName,
      appVersion: config.appVersion,
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
