/**
 * @file src/services/tavern-import/png-parser.js
 * @description PNG metadata extraction for SillyTavern/TavernAI cards.
 */

'use strict';

const zlib = require('node:zlib');
const { safeJsonParse } = require('./text-utils');

function decodeMaybeBase64Json(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('{') || raw.startsWith('[')) return safeJsonParse(raw);
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    if (decoded.startsWith('{') || decoded.startsWith('[')) return safeJsonParse(decoded);
  } catch (_) {}
  return null;
}

function readPngChunks(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error('PNG_SIGNATURE_INVALID');
  }
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) break;
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

function extractPngTextEntries(buffer) {
  const zlib = require('node:zlib');
  const entries = [];
  for (const chunk of readPngChunks(buffer)) {
    if (chunk.type === 'tEXt') {
      const separator = chunk.data.indexOf(0);
      if (separator <= 0) continue;
      const rawValue = chunk.data.subarray(separator + 1);
      entries.push({
        key: chunk.data.subarray(0, separator).toString('latin1'),
        value: rawValue.toString('latin1'),
        valueUtf8: rawValue.toString('utf8'),
      });
    }
    if (chunk.type === 'zTXt') {
      const separator = chunk.data.indexOf(0);
      if (separator <= 0 || separator + 2 > chunk.data.length) continue;
      const method = chunk.data[separator + 1];
      if (method !== 0) continue;
      try {
        entries.push({
          key: chunk.data.subarray(0, separator).toString('latin1'),
          value: zlib.inflateSync(chunk.data.subarray(separator + 2)).toString('utf8'),
        });
      } catch (_) {}
    }
    if (chunk.type === 'iTXt') {
      const firstNull = chunk.data.indexOf(0);
      if (firstNull <= 0) continue;
      const key = chunk.data.subarray(0, firstNull).toString('latin1');
      let cursor = firstNull + 1;
      const compressionFlag = chunk.data[cursor];
      const compressionMethod = chunk.data[cursor + 1];
      cursor += 2;
      const languageEnd = chunk.data.indexOf(0, cursor);
      if (languageEnd < 0) continue;
      cursor = languageEnd + 1;
      const translatedEnd = chunk.data.indexOf(0, cursor);
      if (translatedEnd < 0) continue;
      cursor = translatedEnd + 1;
      let textBuffer = chunk.data.subarray(cursor);
      if (compressionFlag === 1 && compressionMethod === 0) {
        try { textBuffer = zlib.inflateSync(textBuffer); } catch (_) { continue; }
      }
      entries.push({ key, value: textBuffer.toString('utf8') });
    }
  }
  return entries;
}

function extractCardJsonFromPng(buffer) {
  const entries = extractPngTextEntries(buffer);
  const preferredKeys = ['chara', 'ccv3', 'character', 'card', 'metadata'];
  const parseEntry = (entry) => decodeMaybeBase64Json(entry?.value || '') || decodeMaybeBase64Json(entry?.valueUtf8 || '');
  for (const key of preferredKeys) {
    const entry = entries.find((item) => String(item.key || '').toLowerCase() === key);
    const parsed = parseEntry(entry);
    if (parsed) return parsed;
  }
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (parsed && (parsed.data || parsed.name || parsed.char_name || parsed.spec || parsed.character_book)) {
      return parsed;
    }
  }
  return null;
}


module.exports = {
  extractCardJsonFromPng,
  extractPngTextEntries,
  readPngChunks,
};
