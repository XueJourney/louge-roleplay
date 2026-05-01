/**
 * @file src/server-helpers/request-meta.js
 * @description 请求来源与账号标识脱敏工具。日志只记录可排障信息，不写入完整邮箱/手机号/密码等敏感值。
 */

const { isEmail, isDomesticPhone } = require('./parsing');

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function maskEmail(email = '') {
  const raw = String(email || '').trim().toLowerCase();
  if (!raw || !raw.includes('@')) {
    return '';
  }
  const [localPart, domain] = raw.split('@');
  if (!localPart || !domain) {
    return '';
  }
  if (localPart.length <= 2) {
    return `${localPart[0] || '*'}***@${domain}`;
  }
  return `${localPart.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone = '') {
  const raw = String(phone || '').replace(/\s+/g, '');
  if (!raw) {
    return '';
  }
  if (raw.length <= 4) {
    return `${raw.slice(0, 1)}***`;
  }
  return `${raw.slice(0, 3)}****${raw.slice(-4)}`;
}

function buildRegisterLogMeta(req, payload = {}) {
  return {
    requestId: req.requestId,
    ip: getClientIp(req),
    username: String(payload.username || '').trim() || '',
    countryType: String(payload.countryType || '').trim() || '',
    email: maskEmail(payload.email || ''),
    phone: maskPhone(payload.phone || ''),
  };
}

function buildLoginLogMeta(req, payload = {}) {
  const login = String(payload.login || '').trim();
  return {
    requestId: req.requestId,
    ip: getClientIp(req),
    login: isEmail(login) ? maskEmail(login) : (isDomesticPhone(login) ? maskPhone(login) : login.slice(0, 3) + (login.length > 3 ? '***' : '')),
  };
}

module.exports = {
  getClientIp,
  maskEmail,
  maskPhone,
  buildRegisterLogMeta,
  buildLoginLogMeta,
};
