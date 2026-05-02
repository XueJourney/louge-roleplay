/**
 * @file src/services/tavern-import/avatar-storage.js
 * @description Avatar preview and storage helpers for Tavern card imports.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { MAX_IMPORT_FILE_BYTES } = require('./constants');
const { sanitizeImportFileName } = require('./text-utils');
const { normalizeStoredImagePath } = require('../upload-service');

const CHARACTER_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'characters');
const PUBLIC_CHARACTER_UPLOAD_BASE = '/public/uploads/characters';

function buildAvatarPreviewDataUrl(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime !== 'image/png') return '';
  const buffer = file.buffer || Buffer.alloc(0);
  if (!buffer.length || buffer.length > MAX_IMPORT_FILE_BYTES) return '';
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function storeImportedAvatarFromPreview(item = {}) {
  if (!item.avatarPreviewDataUrl) return null;
  const match = String(item.avatarPreviewDataUrl).match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > MAX_IMPORT_FILE_BYTES) return null;
  try {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buffer.subarray(0, 8).equals(signature)) return null;
  } catch (_) {
    return null;
  }
  await fs.mkdir(CHARACTER_UPLOAD_DIR, { recursive: true });
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const sourceBase = sanitizeImportFileName(item.fileName || 'tavern-card.png').replace(/\.png$/i, '');
  const filename = `${Date.now()}-${hash}-${sourceBase}.png`.slice(0, 180);
  let safeFilename = sanitizeImportFileName(filename, `${Date.now()}-${hash}.png`);
  let filePath = path.join(CHARACTER_UPLOAD_DIR, safeFilename);
  try {
    await fs.writeFile(filePath, buffer, { flag: 'wx' });
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    safeFilename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${hash}.png`;
    filePath = path.join(CHARACTER_UPLOAD_DIR, safeFilename);
    await fs.writeFile(filePath, buffer, { flag: 'wx' });
  }
  const storedPath = `${PUBLIC_CHARACTER_UPLOAD_BASE}/${path.basename(filePath)}`;
  return normalizeStoredImagePath(storedPath);
}


module.exports = {
  buildAvatarPreviewDataUrl,
  storeImportedAvatarFromPreview,
};
