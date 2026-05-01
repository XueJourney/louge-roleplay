/**
 * @file src/lib/logger.js
 * @description
 * 统一结构化日志输出工具。
 *
 * 调用说明：
 * - 后端代码不要直接 console.log/console.error，统一使用 logger.info/warn/error/debug。
 * - meta 会被 JSON.stringify 成结构化字段，方便 grep requestId、conversationId、jobId。
 * - 通过 LOG_LEVEL 控制输出级别：debug < info < warn < error，默认 info。
 * - logger 会对常见敏感字段做递归脱敏；仍禁止主动写入密码、Cookie、API Key、完整 prompt 等敏感内容。
 */

const LEVEL_WEIGHT = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const { appendDailyLog } = require('../services/log-service');

const configuredLevel = String(process.env.LOG_LEVEL || 'info').trim().toLowerCase();
const minimumLevel = Object.prototype.hasOwnProperty.call(LEVEL_WEIGHT, configuredLevel)
  ? configuredLevel
  : 'info';

const SENSITIVE_KEY_PATTERN = /(password|passwd|pwd|secret|token|apikey|api_key|authorization|cookie|set-cookie|credential|session|prompt|messages|content|body|text)/i;
const MAX_STRING_LENGTH = 600;

function redactString(value) {
  const raw = String(value || '');
  if (raw.length <= MAX_STRING_LENGTH) {
    return raw;
  }
  return `${raw.slice(0, MAX_STRING_LENGTH)}…[truncated:${raw.length}]`;
}

function sanitizeLogMeta(value, depth = 0, key = '') {
  if (value === null || value === undefined) {
    return value;
  }
  if (SENSITIVE_KEY_PATTERN.test(String(key || ''))) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }
  if (depth >= 5) {
    return '[MaxDepth]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeLogMeta(item, depth + 1));
  }
  if (typeof value === 'object') {
    const output = {};
    Object.entries(value).slice(0, 80).forEach(([entryKey, entryValue]) => {
      output[entryKey] = sanitizeLogMeta(entryValue, depth + 1, entryKey);
    });
    return output;
  }
  return String(value);
}

/**
 * 把日志附加信息转成 JSON；遇到循环引用时返回兜底内容，避免日志本身导致业务崩溃。
 *
 * @param {object} [meta={}]
 * @returns {string}
 */
function formatMeta(meta = {}) {
  try {
    return JSON.stringify(sanitizeLogMeta(meta));
  } catch (error) {
    return '{"meta":"unserializable"}';
  }
}

/**
 * 判断某个级别在当前 LOG_LEVEL 下是否应该输出。
 *
 * @param {'debug'|'info'|'warn'|'error'} level
 * @returns {boolean}
 */
function shouldLog(level) {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minimumLevel];
}

/**
 * 输出单条日志。
 *
 * @param {'debug'|'info'|'warn'|'error'} level 日志级别
 * @param {string} message 简短、稳定、可 grep 的事件名称
 * @param {object} [meta={}] 结构化上下文，例如 requestId/userId/conversationId/error
 */
function log(level, message, meta = {}) {
  const normalizedLevel = String(level || 'info').toLowerCase();
  if (!shouldLog(normalizedLevel)) {
    return;
  }
  const time = new Date().toISOString();
  const upperLevel = normalizedLevel.toUpperCase();
  const line = `[${time}] [${upperLevel}] ${message} ${formatMeta(meta)}`;
  appendDailyLog(normalizedLevel === 'error' ? 'app-error' : 'app', line);
  console.log(line);
}

module.exports = {
  /**
   * 记录正常业务事件，例如启动完成、登录成功、Provider 请求开始。
   * @param {string} message
   * @param {object} [meta]
   */
  info(message, meta) {
    log('info', message, meta);
  },

  /**
   * 记录可恢复异常，例如缓存失败后回源、鉴权失败、参数校验失败。
   * @param {string} message
   * @param {object} [meta]
   */
  warn(message, meta) {
    log('warn', message, meta);
  },

  /**
   * 记录不可恢复或需要立即关注的错误。
   * @param {string} message
   * @param {object} [meta]
   */
  error(message, meta) {
    log('error', message, meta);
  },

  /**
   * 记录调试细节；仅 LOG_LEVEL=debug 时输出，适合队列长度、缓存命中、上下文裁剪等高频信息。
   * @param {string} message
   * @param {object} [meta]
   */
  debug(message, meta) {
    log('debug', message, meta);
  },

  sanitizeLogMeta,
};
