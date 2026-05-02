/**
 * @file src/constants/character-limits.js
 * @description 角色卡字段长度上限与裁剪工具。
 */

'use strict';

const MAX_CHARACTER_FIELD_LENGTH = 5000;

function clampCharacterField(value, maxLength = MAX_CHARACTER_FIELD_LENGTH) {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

module.exports = {
  MAX_CHARACTER_FIELD_LENGTH,
  clampCharacterField,
};
