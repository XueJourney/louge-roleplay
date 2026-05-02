/**
 * @file src/services/tavern-card-import-service.js
 * @description SillyTavern/TavernAI 角色卡 PNG/JSON 解析与后台批量导入服务。
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants: fsConstants } = require('node:fs');
const multer = require('multer');
const { query, withTransaction } = require('../lib/db');
const { setCharacterTags, parseTagInput } = require('./character-tag-service');
const { normalizeStoredImagePath } = require('./upload-service');

const MAX_IMPORT_FILES = 30;
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_FIELD = 20000;
const PREVIEW_DIR = path.join(process.cwd(), 'data', 'import-previews');
const CHARACTER_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'characters');
const PUBLIC_CHARACTER_UPLOAD_BASE = '/public/uploads/characters';
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

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

function decodeEscapedText(value) {
  let text = String(value ?? '').replace(/\u0000/g, '');
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


function sanitizeImportFileName(value, fallback = 'tavern-card.png') {
  const base = path.basename(String(value || fallback)).replace(/[^\p{Letter}\p{Number}._-]+/gu, '-').slice(0, 120);
  return base || fallback;
}

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

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch (_) {
    return null;
  }
}

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
      entries.push({
        key: chunk.data.subarray(0, separator).toString('latin1'),
        value: chunk.data.subarray(separator + 1).toString('latin1'),
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
  for (const key of preferredKeys) {
    const entry = entries.find((item) => String(item.key || '').toLowerCase() === key);
    const parsed = decodeMaybeBase64Json(entry?.value || '');
    if (parsed) return parsed;
  }
  for (const entry of entries) {
    const parsed = decodeMaybeBase64Json(entry.value);
    if (parsed && (parsed.data || parsed.name || parsed.char_name || parsed.spec || parsed.character_book)) {
      return parsed;
    }
  }
  return null;
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

function collectTagsFromCard(root, data) {
  const tags = [];
  const candidates = [data.tags, root.tags, data.extensions?.tags, root.extensions?.tags];
  candidates.forEach((candidate) => {
    if (Array.isArray(candidate)) tags.push(...candidate);
    else if (typeof candidate === 'string') tags.push(...candidate.split(/[，,\n]/g));
  });
  return parseTagInput(tags);
}

function normalizeWorldBookEntries(book) {
  if (!book || typeof book !== 'object') return [];
  const rawEntries = Array.isArray(book.entries)
    ? book.entries
    : Object.values(book.entries || {});
  return rawEntries
    .map((entry, index) => {
      const keys = Array.isArray(entry.keys) ? entry.keys : Array.isArray(entry.key) ? entry.key : [];
      const secondaryKeys = Array.isArray(entry.secondary_keys) ? entry.secondary_keys : Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : [];
      return {
        index,
        name: pickFirst(entry.comment, entry.name, entry.title, `条目 ${index + 1}`),
        keys: keys.map((item) => String(item || '').trim()).filter(Boolean),
        secondaryKeys: secondaryKeys.map((item) => String(item || '').trim()).filter(Boolean),
        content: pickFirst(entry.content, entry.entry, entry.text, entry.value),
        enabled: entry.enabled === undefined ? true : Boolean(entry.enabled),
        position: entry.position ?? entry.insertion_order ?? entry.order ?? null,
      };
    })
    .filter((entry) => entry.content);
}

function findWorldBooks(root, data) {
  const books = [];
  [data.character_book, root.character_book, data.world_book, root.world_book, data.extensions?.world_book, root.extensions?.world_book].forEach((book) => {
    if (book && typeof book === 'object') books.push(book);
  });
  if (Array.isArray(data.worlds)) books.push(...data.worlds.filter((item) => item && typeof item === 'object'));
  if (Array.isArray(root.worlds)) books.push(...root.worlds.filter((item) => item && typeof item === 'object'));
  return books;
}

function flattenWorldBooks(root, data) {
  const entries = findWorldBooks(root, data).flatMap(normalizeWorldBookEntries);
  if (!entries.length) {
    return { entries: [], text: '', raw: null, warning: '' };
  }
  const text = [
    '【世界书 / 背景资料】',
    '',
    '以下内容来自原酒馆卡世界书。楼阁当前不支持关键词触发式世界书，因此已将其完整合并进角色设定中。',
    '',
    ...entries.map((entry, index) => [
      `${index + 1}. 条目名称：${entry.name || `条目 ${index + 1}`}`,
      entry.keys.length ? `关键词：${entry.keys.join(', ')}` : '',
      entry.secondaryKeys.length ? `次级关键词：${entry.secondaryKeys.join(', ')}` : '',
      entry.enabled ? '' : '状态：原条目为停用，已随卡片一并保留。',
      '内容：',
      entry.content,
    ].filter(Boolean).join('\n')),
  ].join('\n');
  return {
    entries,
    text: truncateText(text, 60000),
    raw: findWorldBooks(root, data),
    warning: text.length > 12000 ? '世界书内容较长，可能影响上下文' : '',
  };
}

function normalizeCardPayload(cardJson) {
  const root = cardJson && typeof cardJson === 'object' ? cardJson : {};
  const data = root.data && typeof root.data === 'object' ? root.data : root;
  const extensions = normalizeExtensions(data.extensions || root.extensions);
  const worldBook = flattenWorldBooks(root, data);

  const name = pickFirst(data.name, root.name, data.char_name, root.char_name);
  const description = pickFirst(data.description, root.description, data.personality, root.personality);
  const personality = pickFirst(data.personality, root.personality);
  const scenario = pickFirst(data.scenario, root.scenario);
  const mesExample = pickFirst(data.mes_example, root.mes_example, data.example_dialogue, root.example_dialogue);
  const creatorNotes = pickFirst(data.creator_notes, root.creator_notes, data.creatorcomment, root.creatorcomment);
  const systemPrompt = pickFirst(data.system_prompt, root.system_prompt, extensions.system_prompt);
  const postHistory = pickFirst(data.post_history_instructions, root.post_history_instructions, extensions.post_history_instructions);
  const firstMessage = pickFirst(data.first_mes, root.first_mes, data.first_message, root.first_message);
  const summary = pickFirst(data.summary, root.summary, description).slice(0, 500);

  const promptItems = [
    { key: '角色名', value: name, sortOrder: 0, isEnabled: true },
    { key: '角色简介', value: summary, sortOrder: 1, isEnabled: true },
    { key: '角色', value: description, sortOrder: 2, isEnabled: true },
    { key: '描述角色性格', value: personality || description, sortOrder: 3, isEnabled: true },
    { key: '当前场景', value: scenario, sortOrder: 4, isEnabled: true },
    { key: '示例对话', value: mesExample, sortOrder: 5, isEnabled: true },
    { key: '系统提示词', value: systemPrompt, sortOrder: 6, isEnabled: true },
    { key: '后历史指令', value: postHistory, sortOrder: 7, isEnabled: true },
    { key: '创作者备注', value: creatorNotes, sortOrder: 8, isEnabled: true },
    { key: '世界书 / 背景资料', value: worldBook.text, sortOrder: 9, isEnabled: true },
  ].filter((item) => item.value);

  return {
    name,
    summary: summary || `${name || '未命名角色'} · 酒馆卡导入`,
    personality: [personality || description, worldBook.text].filter(Boolean).join('\n\n'),
    firstMessage,
    promptProfileItems: promptItems,
    tags: collectTagsFromCard(root, data),
    sourceFormat: String(root.spec || root.spec_version || data.spec || data.spec_version || 'tavern-card').slice(0, 80),
    sourceCardJson: root,
    importedWorldBookJson: worldBook.raw,
    flattenedWorldBookText: worldBook.text,
    warnings: [worldBook.warning, name ? '' : '缺少角色名称，请手动填写'].filter(Boolean),
  };
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
    parsed.name = originalName.replace(/\.[^.]+$/, '').slice(0, 100) || '未命名角色';
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
        avatarPreviewDataUrl: buildAvatarPreviewDataUrl(file),
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
  const name = truncateText(item.name || parsed.name, 100) || '未命名角色';
  return {
    fileName: truncateText(item.fileName, 255, { decodeEscapes: false }),
    fileHash: truncateText(item.fileHash, 64, { decodeEscapes: false }),
    name,
    summary: truncateText(item.summary || parsed.summary || `${name} · 酒馆卡导入`, 500),
    personality: truncateText(item.personality || parsed.personality || ''),
    firstMessage: truncateText(item.firstMessage || parsed.firstMessage || '', 2000),
    promptProfileItems: Array.isArray(parsed.promptProfileItems) ? parsed.promptProfileItems : [],
    tags: parseTagInput(item.tags || parsed.tags || []),
    visibility: String(item.visibility || 'public') === 'private' ? 'private' : 'public',
    isNsfw: Boolean(item.isNsfw),
    duplicateAction: ['skip', 'copy', 'overwrite'].includes(String(item.duplicateAction || 'copy')) ? String(item.duplicateAction || 'copy') : 'copy',
    duplicateId: Number(item.duplicate?.id || item.duplicateId || 0) || null,
    avatarPreviewDataUrl: String(item.avatarPreviewDataUrl || '').trim(),
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
      avatarPreviewDataUrl: previewItem.avatarPreviewDataUrl || '',
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
                 avatar_image_path = COALESCE(?, avatar_image_path), source_type = 'tavern', source_format = ?, source_file_name = ?, source_file_hash = ?, source_card_json = ?, imported_world_book_json = ?,
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
              await storeImportedAvatarFromPreview(item),
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
              await storeImportedAvatarFromPreview(item),
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
