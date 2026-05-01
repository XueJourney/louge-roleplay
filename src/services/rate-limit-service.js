/**
 * @file src/services/rate-limit-service.js
 * @description 基于 Redis 的简易限流服务，防止验证码与登录注册接口被批量刷请求。
 */

const { redisClient } = require('../lib/redis');
const config = require('../config');
const logger = require('../lib/logger');

async function hitLimit(key, windowSeconds, limit) {
  try {
    const count = await redisClient.incr(key);
    if (count === 1) {
      await redisClient.expire(key, windowSeconds);
    }
    return count > limit;
  } catch (error) {
    logger.error('Rate limit backend failed', { key, windowSeconds, limit, error: error.message });
    return process.env.NODE_ENV === 'production' && config.rateLimitFailClosed;
  }
}

module.exports = {
  hitLimit,
};
