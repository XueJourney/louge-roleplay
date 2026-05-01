/**
 * @file src/lib/user-public-id.js
 * @description 用户公开唯一 ID 生成工具。公开 ID 从三位起步，无固定上限。
 */

'use strict';

const crypto = require('node:crypto');

const USER_PUBLIC_ID_MIN_DIGITS = 3;
const USER_PUBLIC_ID_MAX_ATTEMPTS_PER_DIGIT = 30;
const USER_PUBLIC_ID_MAX_SAFE_DIGITS = 15;

function getRandomDigits(length) {
  const firstDigit = crypto.randomInt(1, 10);
  let value = String(firstDigit);
  while (value.length < length) {
    value += String(crypto.randomInt(0, 10));
  }
  return value;
}

async function generateUniqueUserPublicId(exists) {
  if (typeof exists !== 'function') {
    throw new TypeError('generateUniqueUserPublicId requires an async exists(publicId) function');
  }

  let digits = USER_PUBLIC_ID_MIN_DIGITS;
  while (digits <= USER_PUBLIC_ID_MAX_SAFE_DIGITS) {
    for (let attempt = 0; attempt < USER_PUBLIC_ID_MAX_ATTEMPTS_PER_DIGIT; attempt += 1) {
      const publicId = getRandomDigits(digits);
      // eslint-disable-next-line no-await-in-loop
      if (!(await exists(publicId))) {
        return publicId;
      }
    }
    digits += 1;
  }

  // 理论上很难走到这里。继续扩位，满足“没有上限”的业务要求。
  while (true) {
    const publicId = getRandomDigits(digits);
    // eslint-disable-next-line no-await-in-loop
    if (!(await exists(publicId))) {
      return publicId;
    }
    digits += 1;
  }
}

module.exports = {
  USER_PUBLIC_ID_MIN_DIGITS,
  generateUniqueUserPublicId,
};
