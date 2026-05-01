/**
 * @file src/server-helpers/parsing.js
 * @description 路由层参数解析与基础账号格式校验。外部输入必须显式校验，避免 `Number(...) || 0` 把非法值静默吞掉。
 */

function parseIntegerField(value, options = {}) {
  const {
    fieldLabel = '数值字段',
    defaultValue,
    min,
    allowEmpty = false,
  } = options;

  const raw = String(value ?? '').trim();
  if (!raw) {
    if (allowEmpty) {
      return null;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`${fieldLabel}不能为空。`);
  }

  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${fieldLabel}必须是整数。`);
  }

  const normalized = Number(raw);
  if (!Number.isSafeInteger(normalized)) {
    throw new Error(`${fieldLabel}超出允许范围。`);
  }
  if (min !== undefined && normalized < min) {
    throw new Error(`${fieldLabel}不能小于 ${min}。`);
  }
  return normalized;
}

function parseNumberField(value, options = {}) {
  const {
    fieldLabel = '数值字段',
    defaultValue,
    min,
    allowEmpty = false,
  } = options;

  const raw = String(value ?? '').trim();
  if (!raw) {
    if (allowEmpty) {
      return null;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`${fieldLabel}不能为空。`);
  }

  const normalized = Number(raw);
  if (!Number.isFinite(normalized)) {
    throw new Error(`${fieldLabel}必须是数字。`);
  }
  if (min !== undefined && normalized < min) {
    throw new Error(`${fieldLabel}不能小于 ${min}。`);
  }
  return normalized;
}

function parseIdParam(value, fieldLabel = 'ID') {
  return parseIntegerField(value, { fieldLabel, min: 1 });
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isAllowedInternationalEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const domain = email.split('@')[1] || '';
  const allowedDomains = new Set([
    'gmail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'msn.com',
    'icloud.com',
    'me.com',
    'mac.com',
    'yahoo.com',
    'yahoo.co.jp',
    'yahoo.co.uk',
    'ymail.com',
    'aol.com',
    'proton.me',
    'protonmail.com',
  ]);
  return allowedDomains.has(domain);
}

function isDomesticPhone(value) {
  return /^1\d{10}$/.test(String(value || '').trim());
}

module.exports = {
  parseIntegerField,
  parseNumberField,
  parseIdParam,
  isEmail,
  isAllowedInternationalEmail,
  isDomesticPhone,
};
