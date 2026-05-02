/**
 * @file src/services/tavern-card-import-service.js
 * @description Public facade for SillyTavern/TavernAI character card import.
 */

'use strict';

const crypto = require('node:crypto');
const multer = require('multer');
const { query, withTransaction } = require('../lib/db');
const { setCharacterTags, parseTagInput } = require('./character-tag-service');
const { MAX_IMPORT_FILES, MAX_IMPORT_FILE_BYTES } = require('./tavern-import/constants');
const { MAX_CHARACTER_FIELD_LENGTH, clampCharacterField } = require('../constants/character-limits');
const { truncateText, safeJsonParse, normalizeTavernTemplateText } = require('./tavern-import/text-utils');
const { extractCardJsonFromPng } = require('./tavern-import/png-parser');
const { normalizeCardPayload } = require('./tavern-import/card-payload');
const { saveImportPreview, loadImportPreview, deleteImportPreview, importPreviewExists } = require('./tavern-import/preview-store');

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: MAX_IMPORT_FILES },
  fileFilter(_req, file, cb) {
    const originalName = String(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    if (originalName.endsWith('.json') || originalName.endsWith('.png') || mime === 'application/json' || mime === 'image/png') {
      cb(null, true);
      return;
    }
    const error = new Error('TAVERN_IMPORT_FILE_TYPE_UNSUPPORTED');
    error.code = 'TAVERN_IMPORT_FILE_TYPE_UNSUPPORTED';
    cb(error);
  },
});

function mapImportUploadError(error) {
  if (!error) return error;
  if (error.code === 'LIMIT_FILE_SIZE') {
    error.message = '单个酒馆卡文件不能超过 10MB。';
    error.statusCode = 400;
  } else if (error.code === 'LIMIT_FILE_COUNT') {
    error.message = '一次最多上传 30 个酒馆卡文件。';
    error.statusCode = 400;
  } else if (error.code === 'TAVERN_IMPORT_FILE_TYPE_UNSUPPORTED') {
    error.message = '只支持 SillyTavern/TavernAI 导出的 PNG 或 JSON 文件。';
    error.statusCode = 400;
  }
  return error;
}

function uploadTavernCards(req, res, next) {
  importUpload.array('cards', MAX_IMPORT_FILES)(req, res, (error) => {
    if (error) return next(mapImportUploadError(error));
    return next();
  });
}

function parseTavernFile(file) {
  const originalName = String(file.originalname || 'unknown').trim();
  const buffer = file.buffer || Buffer.alloc(0);
  const ext = originalName.toLowerCase().split('.').pop();
  let cardJson = null;
  if (ext === 'png' || String(file.mimetype || '').toLowerCase() === 'image/png') {
    cardJson = extractCardJsonFromPng(buffer);
    if (!cardJson) {
      const error = new Error('无法从 PNG 中读取角色数据，可能不是有效的 SillyTavern 角色卡。');
      error.code = 'PNG_CARD_DATA_NOT_FOUND';
      throw error;
    }
  } else {
    cardJson = safeJsonParse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    if (!cardJson) {
      const error = new Error('JSON 解析失败');
      error.code = 'JSON_PARSE_FAILED';
      throw error;
    }
  }
  const parsed = normalizeCardPayload(cardJson);
  if (!parsed.name) {
    parsed.name = originalName.replace(/\.[^.]+$/, '').slice(0, MAX_CHARACTER_FIELD_LENGTH) || '未命名角色';
    parsed.warnings.push('缺少角色名称，已先使用文件名');
  }
  return parsed;
}

async function findPossibleDuplicate(name, adminUserId, fileHash = '') {
  const hash = String(fileHash || '').trim();
  if (hash) {
    const byHash = await query(
      "SELECT id, name FROM characters WHERE user_id = ? AND source_file_hash = ? ORDER BY id DESC LIMIT 1",
      [adminUserId, hash],
    ).catch(() => []);
    if (byHash[0]) return { ...byHash[0], reason: 'file_hash' };
  }
  const rows = await query(
    'SELECT id, name FROM characters WHERE user_id = ? AND name = ? ORDER BY id DESC LIMIT 1',
    [adminUserId, name],
  );
  return rows[0] ? { ...rows[0], reason: 'name' } : null;
}

async function previewTavernImport(files = [], adminUserId) {
  const list = Array.isArray(files) ? files : [];
  const items = [];
  for (const [index, file] of list.entries()) {
    const fileHash = crypto.createHash('sha256').update(file.buffer || Buffer.alloc(0)).digest('hex');
    const base = {
      index,
      fileName: String(file.originalname || `file-${index + 1}`),
      fileHash,
      ok: false,
      errorMessage: '',
    };
    try {
      // eslint-disable-next-line no-await-in-loop
      const parsed = parseTavernFile(file);
      // eslint-disable-next-line no-await-in-loop
      const duplicate = await findPossibleDuplicate(parsed.name, adminUserId, fileHash);
      items.push({
        ...base,
        ok: true,
        parsed,
        avatarPreviewDataUrl: '',
        duplicate,
        warnings: [...parsed.warnings, duplicate ? '检测到可能重复的角色' : ''].filter(Boolean),
      });
    } catch (error) {
      items.push({ ...base, errorMessage: error.message || '未检测到 SillyTavern 角色数据' });
    }
  }
  return items;
}

function parseConfirmPayload(body = {}) {
  const raw = String(body.itemsJson || body.adjustmentsJson || '[]');
  const parsed = safeJsonParse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeImportItemForInsert(item = {}) {
  const parsed = item.parsed || {};
  const name = clampCharacterField(item.name || parsed.name) || '未命名角色';
  return {
    fileName: truncateText(item.fileName, 255, { decodeEscapes: false }),
    fileHash: truncateText(item.fileHash, 64, { decodeEscapes: false }),
    name,
    summary: clampCharacterField(item.summary || parsed.summary || `${name} · 酒馆卡导入`),
    personality: clampCharacterField(item.personality || parsed.personality || ''),
    firstMessage: clampCharacterField(item.firstMessage || parsed.firstMessage || ''),
    promptProfileItems: Array.isArray(parsed.promptProfileItems) ? parsed.promptProfileItems : [],
    tags: parseTagInput(item.tags || parsed.tags || []),
    visibility: String(item.visibility || 'public') === 'private' ? 'private' : 'public',
    isNsfw: Boolean(item.isNsfw),
    duplicateAction: ['skip', 'copy', 'overwrite'].includes(String(item.duplicateAction || 'copy')) ? String(item.duplicateAction || 'copy') : 'copy',
    duplicateId: Number(item.duplicate?.id || item.duplicateId || 0) || null,
    avatarPreviewDataUrl: '',
    sourceFormat: truncateText(parsed.sourceFormat || 'tavern-card', 80, { decodeEscapes: false }),
    sourceCardJson: parsed.sourceCardJson || null,
    importedWorldBookJson: parsed.importedWorldBookJson || null,
    flattenedWorldBookText: truncateText(parsed.flattenedWorldBookText || '', 60000),
  };
}

function buildConfirmItemsFromPreview(previewItems = [], body = {}) {
  const adjustments = parseConfirmPayload({ itemsJson: body.adjustmentsJson || body.itemsJson || '[]' });
  const byIndex = new Map(adjustments.map((item) => [Number(item.index), item]));
  return (Array.isArray(previewItems) ? previewItems : []).map((previewItem, index) => {
    const patch = byIndex.get(Number(previewItem.index ?? index)) || {};
    return {
      ...previewItem,
      selected: Boolean(patch.selected),
      name: patch.name,
      summary: patch.summary,
      tags: patch.tags,
      visibility: patch.visibility,
      isNsfw: Boolean(patch.isNsfw),
      duplicateAction: patch.duplicateAction,
      duplicateId: Number(patch.duplicateId || previewItem.duplicate?.id || 0) || null,
      avatarPreviewDataUrl: '',
    };
  });
}

async function confirmTavernImport(adminUserId, submittedItems = []) {
  const items = (Array.isArray(submittedItems) ? submittedItems : [])
    .filter((item) => item && item.ok !== false && item.selected !== false)
    .map(normalizeImportItemForInsert);

  if (!items.length) {
    return { batchId: null, total: 0, successCount: 0, failedCount: 0, skippedCount: 0, message: '没有选中的可导入角色。' };
  }

  return withTransaction(async (conn) => {
    const [batchResult] = await conn.execute(
      `INSERT INTO import_batches (admin_user_id, total_count, success_count, failed_count, skipped_count, status, options_json, created_at, updated_at)
       VALUES (?, ?, 0, 0, 0, 'processing', ?, NOW(), NOW())`,
      [adminUserId, items.length, JSON.stringify({ source: 'admin-tavern-batch' })],
    );
    const batchId = Number(batchResult.insertId);
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const item of items) {
      try {
        let characterId = null;
        let itemStatus = 'success';
        let errorMessage = '';
        if (item.duplicateId && item.duplicateAction === 'skip') {
          itemStatus = 'skipped';
          skippedCount += 1;
        } else if (item.duplicateId && item.duplicateAction === 'overwrite') {
          await conn.execute(
            `UPDATE characters
             SET name = ?, summary = ?, personality = ?, first_message = ?, prompt_profile_json = ?, visibility = ?, is_nsfw = ?,
                 avatar_image_path = avatar_image_path, source_type = 'tavern', source_format = ?, source_file_name = ?, source_file_hash = ?, source_card_json = ?, imported_world_book_json = ?,
                 flattened_world_book_text = ?, import_batch_id = ?, updated_at = NOW()
             WHERE id = ?`,
            [
              item.name,
              item.summary,
              item.personality,
              item.firstMessage,
              JSON.stringify(item.promptProfileItems),
              item.visibility,
              item.isNsfw ? 1 : 0,
              item.sourceFormat,
              item.fileName,
              item.fileHash,
              JSON.stringify(item.sourceCardJson),
              item.importedWorldBookJson ? JSON.stringify(item.importedWorldBookJson) : null,
              item.flattenedWorldBookText || null,
              batchId,
              item.duplicateId,
            ],
          );
          characterId = item.duplicateId;
          await setCharacterTags(characterId, item.tags, conn);
          successCount += 1;
        } else {
          const [insertResult] = await conn.execute(
            `INSERT INTO characters (
               user_id, name, summary, personality, first_message, prompt_profile_json, visibility,
               avatar_image_path, background_image_path, status, is_nsfw, source_type, source_format, source_file_name, source_file_hash,
               source_card_json, imported_world_book_json, flattened_world_book_text, import_batch_id, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'published', ?, 'tavern', ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              adminUserId,
              item.name,
              item.summary,
              item.personality,
              item.firstMessage,
              JSON.stringify(item.promptProfileItems),
              item.visibility,
              null,
              item.isNsfw ? 1 : 0,
              item.sourceFormat,
              item.fileName,
              item.fileHash,
              JSON.stringify(item.sourceCardJson),
              item.importedWorldBookJson ? JSON.stringify(item.importedWorldBookJson) : null,
              item.flattenedWorldBookText || null,
              batchId,
            ],
          );
          characterId = Number(insertResult.insertId);
          await setCharacterTags(characterId, item.tags, conn);
          successCount += 1;
        }

        await conn.execute(
          `INSERT INTO import_items (batch_id, file_name, file_hash, status, error_message, parsed_role_name, created_role_id, raw_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [batchId, item.fileName, item.fileHash, itemStatus, errorMessage, item.name, characterId, JSON.stringify(item.sourceCardJson)],
        );
      } catch (error) {
        failedCount += 1;
        await conn.execute(
          `INSERT INTO import_items (batch_id, file_name, file_hash, status, error_message, parsed_role_name, created_role_id, raw_json, created_at)
           VALUES (?, ?, ?, 'failed', ?, ?, NULL, ?, NOW())`,
          [batchId, item.fileName, item.fileHash, String(error.message || '导入失败').slice(0, 1000), item.name, JSON.stringify(item.sourceCardJson)],
        );
      }
    }

    await conn.execute(
      `UPDATE import_batches SET success_count = ?, failed_count = ?, skipped_count = ?, status = ?, updated_at = NOW() WHERE id = ?`,
      [successCount, failedCount, skippedCount, failedCount > 0 ? 'partial' : 'completed', batchId],
    );

    return { batchId, total: items.length, successCount, failedCount, skippedCount };
  });
}

async function listImportBatches(limit = 20) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit || 20)));
  const batches = await query(
    `SELECT b.*, u.username AS admin_username
     FROM import_batches b
     LEFT JOIN users u ON u.id = b.admin_user_id
     ORDER BY b.id DESC
     LIMIT ${safeLimit}`,
  );
  if (!batches.length) return [];
  const ids = batches.map((batch) => Number(batch.id));
  const rows = await query(
    `SELECT * FROM import_items WHERE batch_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`,
    ids,
  );
  const byBatch = new Map(ids.map((id) => [id, []]));
  rows.forEach((row) => byBatch.get(Number(row.batch_id))?.push(row));
  return batches.map((batch) => ({ ...batch, items: byBatch.get(Number(batch.id)) || [] }));
}

module.exports = {
  uploadTavernCards,
  parseTavernFile,
  normalizeTavernTemplateText,
  previewTavernImport,
  saveImportPreview,
  loadImportPreview,
  deleteImportPreview,
  parseConfirmPayload,
  importPreviewExists,
  buildConfirmItemsFromPreview,
  confirmTavernImport,
  listImportBatches,
};
