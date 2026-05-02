/**
 * @file src/services/tavern-import/text-utils.js
 * @description Text normalization helpers for Tavern card import.
 */

'use strict';

const path = require('node:path');
const { MAX_TEXT_FIELD } = require('./constants');

function looksLikeMojibake(value) {
  const text = String(value || '');
  if (!text) return false;
  const replacementCount = (text.match(/�/g) || []).length;
  const latin1ArtifactCount = (text.match(/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g) || []).length;
  return replacementCount > 0 || latin1ArtifactCount >= 2;
}

function encodePossiblyWindows1252AsBytes(text) {
  const windows1252 = new Map([
    [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
    [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E],
    [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
  ]);
  const bytes = [];
  for (const char of String(text || '')) {
    const code = char.codePointAt(0);
    if (code <= 0xff) bytes.push(code);
    else if (windows1252.has(code)) bytes.push(windows1252.get(code));
    else return null;
  }
  return Buffer.from(bytes);
}

function repairLatin1Utf8Text(value) {
  const text = String(value ?? '').replace(/\u0000/g, '');
  if (!text || !looksLikeMojibake(text)) return text;
  try {
    const bytes = encodePossiblyWindows1252AsBytes(text) || Buffer.from(text, 'latin1');
    const repaired = bytes.toString('utf8');
    return looksLikeMojibake(repaired) && repaired.length >= text.length ? text : repaired;
  } catch (_) {
    return text;
  }
}

function decodeEscapedText(value) {
  let text = repairLatin1Utf8Text(value);
  for (let i = 0; i < 2; i += 1) {
    const next = text
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
    if (next === text) break;
    text = next;
  }
  return text;
}

function truncateText(value, maxLength = MAX_TEXT_FIELD, options = {}) {
  const shouldDecodeEscapes = options.decodeEscapes === undefined ? true : Boolean(options.decodeEscapes);
  const raw = shouldDecodeEscapes ? decodeEscapedText(value) : String(value ?? '').replace(/\u0000/g, '');
  const text = raw.trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}


function safeJsonParse(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch (_) {
    return null;
  }
}

function normalizeExtensions(value) {
  if (!value || typeof value !== 'object') return {};
  return value;
}

function pickFirst(...values) {
  for (const value of values) {
    const text = truncateText(value, MAX_TEXT_FIELD);
    if (text) return text;
  }
  return '';
}

function normalizeLineBreaks(value) {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeTavernTemplateText(value, context = {}) {
  const charName = String(context.charName || context.characterName || '').trim();
  let text = normalizeLineBreaks(truncateText(value, MAX_TEXT_FIELD));
  text = text
    .replace(/<START>/gi, '')
    .replace(/{{\s*user\s*}}/gi, '{user}')
    .replace(/<USER>/gi, '{user}')
    .replace(/{\s*user\s*}/gi, '{user}')
    .replace(/\bYou:/gi, '{user}:');
  if (charName) {
    text = text
      .replace(/{{\s*char\s*}}/gi, charName)
      .replace(/<BOT>/gi, charName)
      .replace(/{\s*char\s*}/gi, charName)
      .replace(/\bChar:/gi, `${charName}:`);
  }
  return normalizeLineBreaks(text);
}

function joinSections(sections = []) {
  return sections
    .map((section) => normalizeLineBreaks(section))
    .filter(Boolean)
    .join('\n\n');
}


function sanitizeImportFileName(value, fallback = 'tavern-card.png') {
  const base = path.basename(String(value || fallback)).replace(/[^\p{Letter}\p{Number}._-]+/gu, '-').slice(0, 120);
  return base || fallback;
}

module.exports = {
  decodeEscapedText,
  truncateText,
  sanitizeImportFileName,
  safeJsonParse,
  normalizeExtensions,
  pickFirst,
  normalizeLineBreaks,
  normalizeTavernTemplateText,
  joinSections,
};
