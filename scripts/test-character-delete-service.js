#!/usr/bin/env node
/**
 * @file scripts/test-character-delete-service.js
 * @description 回归验证用户侧角色删除：无对话角色可删除，有对话角色受保护，图片清理函数引用可用。
 */

'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { waitReady, query } = require('../src/lib/db');
const {
  createCharacter,
  deleteCharacterSafely,
  getCharacterById,
  ensureCharacterImageColumns,
} = require('../src/services/character-service');
const { createConversation } = require('../src/services/conversation-service');

const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const username = `delete_test_${suffix}`;
const cleanup = {
  userId: null,
  characterIds: [],
  conversationIds: [],
  imagePaths: [],
};

async function cleanupCreatedData() {
  for (const conversationId of [...cleanup.conversationIds].reverse()) {
    try { await query('DELETE FROM messages WHERE conversation_id = ?', [conversationId]); } catch (_) {}
    try { await query('DELETE FROM llm_usage_logs WHERE conversation_id = ?', [conversationId]); } catch (_) {}
    try { await query('DELETE FROM conversations WHERE id = ?', [conversationId]); } catch (_) {}
  }
  for (const characterId of [...cleanup.characterIds].reverse()) {
    try { await query('DELETE FROM character_likes WHERE character_id = ?', [characterId]); } catch (_) {}
    try { await query('DELETE FROM character_comments WHERE character_id = ?', [characterId]); } catch (_) {}
    try { await query('DELETE FROM character_usage_events WHERE character_id = ?', [characterId]); } catch (_) {}
    try { await query('DELETE FROM character_tags WHERE character_id = ?', [characterId]); } catch (_) {}
    try { await query('DELETE FROM characters WHERE id = ?', [characterId]); } catch (_) {}
  }
  if (cleanup.userId) {
    try { await query('DELETE FROM llm_usage_logs WHERE user_id = ?', [cleanup.userId]); } catch (_) {}
    try { await query('DELETE FROM users WHERE id = ?', [cleanup.userId]); } catch (_) {}
  }
  for (const filePath of cleanup.imagePaths) {
    try { fs.unlinkSync(filePath); } catch (_) {}
  }
}

async function createTestUser() {
  const result = await query(
    `INSERT INTO users (username, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, 'user', 'active', NOW(), NOW())`,
    [username, 'test-password-hash'],
  );
  return Number(result.insertId);
}

function createOwnedUploadFixture(filename, content) {
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'characters');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const diskPath = path.join(uploadsDir, filename);
  fs.writeFileSync(diskPath, content);
  cleanup.imagePaths.push(diskPath);
  return `/public/uploads/characters/${filename}`;
}

async function main() {
  await waitReady();
  await ensureCharacterImageColumns();

  const userId = await createTestUser();
  cleanup.userId = userId;

  const avatarPath = createOwnedUploadFixture(`delete-avatar-${suffix}.png`, 'avatar');
  const backgroundPath = createOwnedUploadFixture(`delete-background-${suffix}.webp`, 'background');
  const deletableCharacterId = await createCharacter(userId, {
    name: `Delete Regression ${suffix}`,
    summary: 'delete regression summary',
    personality: 'delete regression personality',
    firstMessage: 'hello',
    visibility: 'private',
    avatarImagePath: avatarPath,
    backgroundImagePath: backgroundPath,
    tags: '删除回归',
  });
  cleanup.characterIds.push(deletableCharacterId);

  await deleteCharacterSafely(deletableCharacterId, userId);
  cleanup.characterIds = cleanup.characterIds.filter((id) => Number(id) !== Number(deletableCharacterId));

  assert.equal(await getCharacterById(deletableCharacterId, userId), null, '无对话角色应可删除');
  assert.equal(fs.existsSync(path.join(process.cwd(), avatarPath.replace(/^\/public\//, 'public/'))), false, '删除角色时应清理头像文件');
  assert.equal(fs.existsSync(path.join(process.cwd(), backgroundPath.replace(/^\/public\//, 'public/'))), false, '删除角色时应清理背景文件');

  const protectedCharacterId = await createCharacter(userId, {
    name: `Protected Delete Regression ${suffix}`,
    summary: 'protected summary',
    personality: 'protected personality',
    firstMessage: 'hello',
    visibility: 'private',
    tags: '删除回归',
  });
  cleanup.characterIds.push(protectedCharacterId);
  const conversationId = await createConversation(userId, protectedCharacterId, 'Delete Regression Conversation');
  cleanup.conversationIds.push(conversationId);

  let protectedDelete = false;
  try {
    await deleteCharacterSafely(protectedCharacterId, userId);
  } catch (error) {
    protectedDelete = error.code === 'CHARACTER_HAS_CONVERSATIONS';
  }
  assert.equal(protectedDelete, true, '有对话角色应继续被保护，避免误删聊天记录');
  assert.ok(await getCharacterById(protectedCharacterId, userId), '删除被保护时角色应保留');

  console.log('Character delete service regression test passed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupCreatedData();
    process.exit(process.exitCode || 0);
  });
