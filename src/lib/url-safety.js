/**
 * @file src/lib/url-safety.js
 * @description 外部服务 URL 安全校验，避免 Provider Base URL 被用于 SSRF/内网探测。
 */

'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

function isPrivateIpv4(ip) {
  const parts = String(ip || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 10
    || a === 127
    || a === 0
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
  );
}

function isPrivateIpv6(ip) {
  const normalized = String(ip || '').toLowerCase();
  return (
    normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
    || normalized.startsWith('ff')
  );
}

function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

function assertSafeHttpsUrl(rawUrl, options = {}) {
  const label = options.label || 'URL';
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch (error) {
    throw new Error(`${label} 格式不正确。`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} 只允许使用 https://。`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${label} 不能包含用户名或密码。`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error(`${label} 不能指向 localhost。`);
  }

  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error(`${label} 不能指向内网、回环或保留地址。`);
  }

  return parsed;
}

async function assertSafeExternalHttpUrl(rawUrl, options = {}) {
  const parsed = assertSafeHttpsUrl(rawUrl, options);
  const hostname = parsed.hostname;

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`${options.label || 'URL'} 域名解析失败：${error.message}`);
  }

  if (!addresses.length) {
    throw new Error(`${options.label || 'URL'} 域名没有可用解析记录。`);
  }

  const blocked = addresses.find((entry) => isPrivateIp(entry.address));
  if (blocked) {
    throw new Error(`${options.label || 'URL'} 解析到了内网、回环或保留地址。`);
  }

  return parsed;
}

module.exports = {
  assertSafeHttpsUrl,
  assertSafeExternalHttpUrl,
  isPrivateIp,
};
