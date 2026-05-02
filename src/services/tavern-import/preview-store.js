/**
 * @file src/services/tavern-import/preview-store.js
 * @description Disk-backed temporary preview storage for Tavern imports.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants: fsConstants } = require('node:fs');
const { PREVIEW_TTL_MS } = require('./constants');
const { safeJsonParse } = require('./text-utils');

const PREVIEW_DIR = path.join(process.cwd(), 'data', 'import-previews');

async function cleanupExpiredPreviewFiles() {
  try {
    const entries = await fs.readdir(PREVIEW_DIR, { withFileTypes: true });
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const filePath = path.join(PREVIEW_DIR, entry.name);
        try {
          const stat = await fs.stat(filePath);
          if (stat.mtimeMs < cutoff) await fs.unlink(filePath);
        } catch (_) {}
      }));
  } catch (_) {}
}

async function saveImportPreview(previewItems = []) {
  await fs.mkdir(PREVIEW_DIR, { recursive: true });
  await cleanupExpiredPreviewFiles();
  const token = crypto.randomUUID();
  const filePath = path.join(PREVIEW_DIR, `${token}.json`);
  await fs.writeFile(filePath, JSON.stringify(previewItems), 'utf8');
  return token;
}

async function loadImportPreview(token) {
  const safeToken = String(token || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(safeToken)) return [];
  const filePath = path.join(PREVIEW_DIR, `${safeToken}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = safeJsonParse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function deleteImportPreview(token) {
  const safeToken = String(token || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(safeToken)) return;
  try { await fs.unlink(path.join(PREVIEW_DIR, `${safeToken}.json`)); } catch (_) {}
}

async function importPreviewExists(token) {
  const safeToken = String(token || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(safeToken)) return false;
  try {
    await fs.access(path.join(PREVIEW_DIR, `${safeToken}.json`), fsConstants.R_OK);
    return true;
  } catch (_) {
    return false;
  }
}


module.exports = {
  saveImportPreview,
  loadImportPreview,
  deleteImportPreview,
  importPreviewExists,
};
