/**
 * @file src/lib/redis.js
 * @description
 * Redis 客户端初始化，供会话存储、验证码缓存、消息树缓存、限流计数器等模块使用。
 *
 * 初始化策略：
 *   1. 若 REDIS_URL 已设置 → initRedis() 时尝试连接真实 Redis
 *   2. Redis 不可用（URL 未设置 或 connect() 失败）→ 保持内存替代实现
 *
 * 实现要点：
 *   导出的 redisClient 是一个 Proxy 对象，其底层实现可在 initRedis() 中被替换。
 *   所有已导入 redisClient 的模块无需改动，Proxy 会透明地转发调用到当前底层实例。
 *
 * 内存替代实现（MemoryRedis）特性：
 *   - 实现项目用到的命令子集：get / set / setEx / del / incr / expire / ping
 *   - 支持 TTL 过期（基于 Date.now() 轮询判断）
 *   - 重启后数据清空（不持久化）；适合本地开发，不适合生产多实例部署
 *
 * 导出：
 *   redisClient       统一代理对象，内部透明切换到真实 Redis 或 MemoryRedis
 *   initRedis()       异步连接 Redis；失败时保持内存模式不抛错
 *   isRedisReal()     返回当前是否在使用真实 Redis（用于决策 session store 类型）
 */

'use strict';

const logger = require('./logger');
const config = require('../config');

// ─── 内存替代实现 ─────────────────────────────────────────────────────────────

/**
 * 内存版 Redis 替代，用于 REDIS_URL 未配置或真实 Redis 连接失败的场景。
 *
 * API 与 redis npm 包的客户端子集保持兼容，可被 captcha-service、
 * rate-limit-service、verification-service、conversation-service 透明使用。
 */
class MemoryRedis {
  constructor() {
    /** @type {Map<string, string>} key → 存储值（统一以字符串存储） */
    this._store = new Map();

    /** @type {Map<string, number>} key → 过期绝对时间戳（ms） */
    this._expiry = new Map();

    this.isOpen = true;

    // 每 60 秒扫描一次 _expiry，清除已过期但从未被访问的 key，防止内存无限增长。
    // unref() 确保此定时器不阻止 Node.js 进程在其他任务完成后自然退出。
    const cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, expiresAt] of this._expiry) {
        if (now > expiresAt) {
          this._store.delete(key);
          this._expiry.delete(key);
        }
      }
    }, 60_000);
    cleanupTimer.unref();
  }

  /**
   * 检查 key 是否过期，过期则删除。
   * @private
   * @param {string} key
   * @returns {boolean}
   */
  _isExpired(key) {
    const expiresAt = this._expiry.get(key);
    if (expiresAt !== undefined && Date.now() > expiresAt) {
      this._store.delete(key);
      this._expiry.delete(key);
      return true;
    }
    return false;
  }

  /**
   * 获取 key 对应的值；不存在或过期返回 null。
   * @param {string} key
   * @returns {Promise<string | null>}
   */
  async get(key) {
    if (this._isExpired(key)) return null;
    return this._store.get(key) ?? null;
  }

  /**
   * 写入 key，并设置 TTL（秒）。
   * @param {string} key
   * @param {number} seconds
   * @param {string} value
   * @returns {Promise<'OK'>}
   */
  async setEx(key, seconds, value) {
    this._store.set(key, String(value));
    this._expiry.set(key, Date.now() + seconds * 1000);
    return 'OK';
  }

  /**
   * 通用写入，支持可选 EX/PX TTL 选项（兼容 redis 包的 set 签名）。
   * @param {string} key
   * @param {string} value
   * @param {{ EX?: number, PX?: number }} [options]
   * @returns {Promise<'OK'>}
   */
  async set(key, value, options = {}) {
    this._store.set(key, String(value));
    if (options.EX) {
      this._expiry.set(key, Date.now() + options.EX * 1000);
    } else if (options.PX) {
      this._expiry.set(key, Date.now() + options.PX);
    } else {
      // 无 TTL：永不过期
      this._expiry.delete(key);
    }
    return 'OK';
  }

  /**
   * 删除一个或多个 key，返回成功删除的数量。
   * @param {...(string | string[])} keys
   * @returns {Promise<number>}
   */
  async del(...keys) {
    let count = 0;
    for (const key of keys.flat()) {
      if (this._store.has(key) && !this._isExpired(key)) {
        this._store.delete(key);
        this._expiry.delete(key);
        count += 1;
      }
    }
    return count;
  }

  /**
   * 对整数计数器执行原子递增。key 不存在或已过期从 0 起计。
   * @param {string} key
   * @returns {Promise<number>}
   */
  async incr(key) {
    if (this._isExpired(key)) {
      this._store.set(key, '1');
      return 1;
    }
    const current = parseInt(this._store.get(key) ?? '0', 10);
    const next = Number.isNaN(current) ? 1 : current + 1;
    this._store.set(key, String(next));
    return next;
  }

  /**
   * 为已存在的 key 设置过期时间。key 不存在返回 0，成功返回 1。
   * @param {string} key
   * @param {number} seconds
   * @returns {Promise<0 | 1>}
   */
  async expire(key, seconds) {
    if (!this._store.has(key) || this._isExpired(key)) return 0;
    this._expiry.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  /**
   * 存活检测，始终返回 'PONG'。
   * @returns {Promise<'PONG'>}
   */
  async ping() {
    return 'PONG';
  }

  /**
   * 兼容 redis 客户端事件监听接口（忽略所有事件，不实际注册）。
   * @returns {this}
   */
  on() {
    return this;
  }
}

// ─── 代理状态（Proxy 透明转发到此处的 client）────────────────────────────────

/**
 * 可变状态容器。
 * Proxy 在每次属性访问时读取 _state.client，因此即使 initRedis() 替换了
 * 底层实现，所有已导入 redisClient 的模块仍能透明使用新实例。
 */
const _state = {
  /** @type {import('redis').RedisClientType | MemoryRedis} */
  client: new MemoryRedis(),

  /** 是否正在使用真实 Redis（true = 已连接 Redis；false = 内存替代） */
  isReal: false,
};

/**
 * 代理对象：透明转发所有属性访问与方法调用到当前底层客户端。
 *
 * 使用 Proxy 而非直接引用的原因：
 *   其他模块在 require 时通过解构拿到此对象的引用。
 *   若直接导出 _state.client，initRedis() 替换底层后旧引用失效。
 *   通过 Proxy 中转，所有引用始终访问到 _state.client 的当前值。
 *
 * @type {import('redis').RedisClientType}
 */
const redisClient = new Proxy(_state, {
  get(target, prop) {
    // 防止 Promise 检测将 Proxy 误判为 thenable
    if (prop === 'then' || prop === 'catch' || prop === 'finally') {
      return undefined;
    }

    const val = target.client[prop];

    // 方法调用：绑定到当前 client，确保 this 指向正确
    if (typeof val === 'function') {
      return (...args) => target.client[prop](...args);
    }

    return val;
  },

  set(target, prop, value) {
    target.client[prop] = value;
    return true;
  },
});

// ─── 公共 API ─────────────────────────────────────────────────────────────────

/**
 * 异步初始化 Redis 连接。
 *
 * 若 REDIS_URL 已配置 → 尝试 connect() + ping()；成功则将底层切换为真实 Redis 客户端。
 * 失败时不抛出错误，打印警告日志后保持内存模式继续运行。
 *
 * 建议在应用 bootstrap() 中调用一次。
 *
 * @returns {Promise<void>}
 */
async function initRedis() {
  if (!config.redisUrl) {
    if (process.env.NODE_ENV === 'production' && config.productionFailFast && !config.allowProductionMemoryRedis) {
      throw new Error('REDIS_URL is required in production unless ALLOW_PRODUCTION_MEMORY_REDIS=true');
    }
    logger.info('[redis] REDIS_URL 未设置，使用内存模式（本地开发）');
    return;
  }

  try {
    const { createClient } = require('redis');
    const realClient = createClient({ url: config.redisUrl });

    realClient.on('error', (error) => {
      logger.error('[redis] 运行时错误', { error: error.message });
    });

    await realClient.connect();
    await realClient.ping();

    // 连接成功：将 Proxy 底层切换到真实 Redis 客户端
    _state.client = realClient;
    _state.isReal = true;

    logger.info('[redis] Redis 连接成功，已切换到真实 Redis 模式');
  } catch (error) {
    // 连接失败：默认保持 MemoryRedis；生产 fail-fast 时直接阻止启动，避免会话/验证码/限流静默退化。
    if (process.env.NODE_ENV === 'production' && config.productionFailFast && !config.allowProductionMemoryRedis) {
      logger.error('[redis] Redis 连接失败，生产模式拒绝降级到内存模式', { error: error.message });
      throw error;
    }
    logger.warn('[redis] Redis 连接失败，保持内存模式运行', {
      error: error.message,
      hint: '验证码、限流计数器、会话将存储在内存中（重启清空）',
    });
  }
}

/**
 * 返回当前是否连接到真实 Redis 服务。
 * 可在 server.js 中用来决定是否启用 RedisStore 会话存储。
 *
 * @returns {boolean}
 */
function isRedisReal() {
  return _state.isReal;
}

module.exports = {
  redisClient,
  initRedis,
  isRedisReal,
};
