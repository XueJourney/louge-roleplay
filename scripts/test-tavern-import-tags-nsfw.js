#!/usr/bin/env node
/**
 * @file scripts/test-tavern-import-tags-nsfw.js
 * @description 覆盖酒馆卡解析/导入、标签 AND/OR、NSFW 隐藏、世界书压平与 PNG 图片不导入头像的回归测试。
 */

'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { waitReady, query } = require('../src/lib/db');
const { ensureCharacterImageColumns, listPublicCharacters, getPublicCharacterDetail } = require('../src/services/character-service');
const { previewTavernImport, buildConfirmItemsFromPreview, confirmTavernImport, importPreviewExists } = require('../src/services/tavern-card-import-service');
const { updateUserNsfwPreference } = require('../src/services/user-service');

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return ~crc;
}

function buildPngCard(cardJson) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rawPixel = Buffer.from([0, 0xff, 0xff, 0xff, 0xff]);
  const idat = zlib.deflateSync(rawPixel);
  const encoded = Buffer.from(JSON.stringify(cardJson), 'utf8').toString('base64');
  const text = Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from(encoded, 'latin1')]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', text),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function ensureTestAdmin() {
  const suffix = crypto.randomBytes(4).toString('hex');
  const username = `import_admin_${suffix}`;
  const result = await query(
    `INSERT INTO users (username, password_hash, role, status, show_nsfw, created_at, updated_at)
     VALUES (?, ?, 'admin', 'active', 0, NOW(), NOW())`,
    [username, 'test-password-hash'],
  );
  return Number(result.insertId);
}

function toImportPreviewTokenPath(token) {
  return path.join(process.cwd(), 'data', 'import-previews', `${token}.json`);
}

async function cleanup(adminId, prefix) {
  const rows = await query('SELECT id, avatar_image_path FROM characters WHERE user_id = ? AND name LIKE ?', [adminId, `${prefix}%`]);
  for (const row of rows) {
    if (row.avatar_image_path && String(row.avatar_image_path).startsWith('/public/uploads/characters/')) {
      const filePath = path.join(process.cwd(), String(row.avatar_image_path).replace(/^\/public\//, 'public/'));
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    await query('DELETE FROM character_tags WHERE character_id = ?', [row.id]).catch(() => {});
    await query('DELETE FROM character_likes WHERE character_id = ?', [row.id]).catch(() => {});
    await query('DELETE FROM character_comments WHERE character_id = ?', [row.id]).catch(() => {});
    await query('DELETE FROM character_usage_events WHERE character_id = ?', [row.id]).catch(() => {});
    await query('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE character_id = ?)', [row.id]).catch(() => {});
    await query('DELETE FROM conversations WHERE character_id = ?', [row.id]).catch(() => {});
    await query('DELETE FROM characters WHERE id = ?', [row.id]).catch(() => {});
  }
  await query('DELETE FROM import_items WHERE parsed_role_name LIKE ?', [`${prefix}%`]).catch(() => {});
  await query('DELETE t FROM tags t LEFT JOIN character_tags ct ON ct.tag_id = t.id WHERE ct.tag_id IS NULL AND t.name IN (?, ?, ?)', ['验收标签A', '验收标签B', '验收标签C']).catch(() => {});
  await query('DELETE FROM users WHERE id = ?', [adminId]).catch(() => {});
}

(async () => {
  await waitReady();
  await ensureCharacterImageColumns();
  const prefix = `验收酒馆卡${Date.now()}`;
  const adminId = await ensureTestAdmin();
  try {
    const card = {
      spec: 'chara_card_v3',
      data: {
        name: `${prefix}Alpha`,
        description: '一个用于导入验收的角色描述。',
        personality: '温柔、谨慎、会解释边界。',
        scenario: '在旧书店里测试导入。',
        first_mes: '你好，{{user}}\\n我从酒馆卡里醒来了，并说：\\"我们开始吧。\\"',
        alternate_greetings: ['<START>\\n{{char}}: 备用开场，{{user}}。'],
        mes_example: '<START>\n{{char}}: 示例对话。',
        tags: ['验收标签A', '验收标签B', '验收标签A'],
        character_book: {
          entries: {
            lore: { keys: ['世界'], content: '世界书内容必须压平成角色提示词，且 {{char}} 会称呼 {{user}}。', enabled: true },
          },
        },
      },
    };
    const jsonFile = {
      originalname: `${prefix}-alpha.json`,
      mimetype: 'application/json',
      buffer: Buffer.from(JSON.stringify(card), 'utf8'),
    };
    const pngFile = {
      originalname: `${prefix}-alpha.png`,
      mimetype: 'image/png',
      buffer: buildPngCard({ data: { ...card.data, name: `${prefix}PngAvatar`, tags: ['验收标签A', '验收标签C'] } }),
    };

    const mojibakeGoodName = `${prefix}Mojibake朝雾花音`;
    const mojibakeName = Buffer.from(mojibakeGoodName, 'utf8').toString('latin1');
    const mojibakeFile = {
      originalname: `${prefix}-mojibake.json`,
      mimetype: 'application/json',
      buffer: Buffer.from(JSON.stringify({ data: { ...card.data, name: mojibakeName, tags: ['验收标签A'] } }), 'utf8'),
    };

    const preview = await previewTavernImport([jsonFile, pngFile, mojibakeFile], adminId);
    assert.equal(preview.length, 3);
    assert.equal(preview.every((item) => item.ok), true);
    assert.equal(preview[2].parsed.name, mojibakeGoodName, '酒馆卡角色名出现 Latin-1/UTF-8 乱码时应自动修复');
    assert.match(preview[0].parsed.flattenedWorldBookText, /世界书内容必须压平成角色提示词/);
    assert.match(preview[0].parsed.flattenedWorldBookText, new RegExp(`${prefix}Alpha 会称呼 \{user\}`), '世界书应解析 {{char}} 并保留运行时用户占位符');
    assert.match(JSON.stringify(preview[0].parsed.promptProfileItems), /备用开场/, '备用开场白应进入提示词片段预览');
    assert.equal(preview[1].avatarPreviewDataUrl, '', '酒馆卡导入不应提取或保存 PNG 图片作为角色头像');

    const importablePreview = preview.slice(0, 2);
    const adjustments = importablePreview.map((item, index) => ({
      index: item.index,
      selected: true,
      name: item.parsed.name,
      summary: `${item.parsed.name} 摘要`,
      tags: index === 0 ? '验收标签A, 验收标签B' : '验收标签A, 验收标签C',
      visibility: 'public',
      isNsfw: index === 0,
      duplicateAction: 'copy',
    }));
    const items = buildConfirmItemsFromPreview(importablePreview, { adjustmentsJson: JSON.stringify(adjustments) });
    const result = await confirmTavernImport(adminId, items);
    assert.equal(result.successCount, 2);
    assert.equal(result.failedCount, 0);
    const importedFirstMessage = await query('SELECT first_message FROM characters WHERE user_id = ? AND name = ?', [adminId, `${prefix}Alpha`]);
    assert.equal(
      importedFirstMessage[0]?.first_message,
      '你好，{user}\n我从酒馆卡里醒来了，并说："我们开始吧。"',
      '酒馆卡 first_mes 应作为楼阁开场白并解析转义字符',
    );

    const duplicatePreview = await previewTavernImport([jsonFile], adminId);
    assert.equal(duplicatePreview[0]?.duplicate?.reason, 'file_hash', '重复检测应优先命中文件 hash');
    const skipItems = buildConfirmItemsFromPreview(duplicatePreview, { adjustmentsJson: JSON.stringify([{ index: 0, selected: true, duplicateAction: 'skip' }]) });
    const skipResult = await confirmTavernImport(adminId, skipItems);
    assert.equal(skipResult.skippedCount, 1, '重复角色选择跳过时不应创建新角色');
    const afterSkip = await query('SELECT COUNT(*) AS count FROM characters WHERE user_id = ? AND name = ?', [adminId, `${prefix}Alpha`]);
    assert.equal(Number(afterSkip[0]?.count || 0), 1, '跳过重复项后角色数量应保持不变');

    const token = crypto.randomUUID();
    assert.equal(await importPreviewExists(token), false, '不存在的导入预览 token 应被拒绝');
    fs.mkdirSync(path.dirname(toImportPreviewTokenPath(token)), { recursive: true });
    fs.writeFileSync(toImportPreviewTokenPath(token), '[]');
    assert.equal(await importPreviewExists(token), true, '存在的导入预览 token 应可确认');
    fs.unlinkSync(toImportPreviewTokenPath(token));

    const hidden = await listPublicCharacters({ tags: '验收标签A', tagMode: 'or', includeNsfw: false, pageSize: 12 });
    assert.equal(hidden.characters.some((item) => item.name === `${prefix}Alpha`), false, 'NSFW 角色默认应隐藏');
    assert.equal(hidden.characters.some((item) => item.name === `${prefix}PngAvatar`), true, '非 NSFW 角色应显示');

    const visible = await listPublicCharacters({ tags: '验收标签A', tagMode: 'or', includeNsfw: true, pageSize: 12 });
    assert.equal(visible.characters.some((item) => item.name === `${prefix}Alpha`), true, '开启 NSFW 后应显示 NSFW 角色');

    const andResult = await listPublicCharacters({ tags: '验收标签A, 验收标签B', tagMode: 'and', includeNsfw: true, pageSize: 12 });
    assert.equal(andResult.characters.some((item) => item.name === `${prefix}Alpha`), true, 'AND 多标签应命中同时具备两个标签的角色');
    assert.equal(andResult.characters.some((item) => item.name === `${prefix}PngAvatar`), false, 'AND 多标签不应命中缺少标签B的角色');

    const createdRows = await query('SELECT id, avatar_image_path, source_file_hash, flattened_world_book_text FROM characters WHERE user_id = ? AND name = ?', [adminId, `${prefix}PngAvatar`]);
    assert.equal(createdRows[0]?.avatar_image_path || '', '', 'PNG 酒馆卡不应保存为角色头像');
    assert.ok(createdRows[0]?.source_file_hash, '应保存文件 hash 以便重复检测');

    const detailHidden = await getPublicCharacterDetail(createdRows[0].id, { includeNsfw: false });
    assert.ok(detailHidden, '非 NSFW 详情应可公开访问');

    await updateUserNsfwPreference(adminId, true);
    const userRows = await query('SELECT show_nsfw FROM users WHERE id = ?', [adminId]);
    assert.equal(Number(userRows[0]?.show_nsfw || 0), 1, '个人资料 NSFW 开关应可保存');

    console.log('Tavern import/tags/NSFW regression test passed.');
  } finally {
    await cleanup(adminId, prefix);
  }
})().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
