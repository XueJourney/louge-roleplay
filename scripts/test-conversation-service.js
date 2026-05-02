#!/usr/bin/env node
/**
 * @file scripts/test-conversation-service.js
 * @description Conversation service regression tests for linear chat refactor behavior.
 */
'use strict';

const assert = require('node:assert/strict');
const { query } = require('../src/lib/db');
const {
  createConversation,
  addMessage,
  cloneConversationBranch,
  getConversationById,
} = require('../src/services/conversation-service');

async function main() {
  const suffix = Date.now();
  const userRow = await query(
    `INSERT INTO users (public_id, username, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, 'test', 'user', 'active', NOW(), NOW())`,
    [`8${String(suffix).slice(-8)}`, `conversation_service_test_${suffix}`],
  );
  const userId = userRow.insertId;
  const characterRow = await query(
    `INSERT INTO characters (user_id, name, summary, visibility, status, created_at, updated_at)
     VALUES (?, ?, 'conversation service regression character', 'private', 'published', NOW(), NOW())`,
    [userId, `会话服务测试角色 ${suffix}`],
  );
  const characterId = characterRow.insertId;
  const conversationIds = [];
  let sourceConversationId = null;

  try {
    sourceConversationId = await createConversation(userId, characterId, {
      title: 'source conversation',
      selectedModelMode: 'force_jailbreak',
    });
    const firstUserMessageId = await addMessage({
      conversationId: sourceConversationId,
      senderType: 'user',
      content: 'hello',
      promptKind: 'normal',
    });
    const firstReplyMessageId = await addMessage({
      conversationId: sourceConversationId,
      senderType: 'character',
      content: 'hi',
      parentMessageId: firstUserMessageId,
      promptKind: 'normal',
    });

    const cloneResult = await cloneConversationBranch({
      userId,
      characterId,
      sourceConversationId,
      sourceLeafMessageId: firstReplyMessageId,
      selectedModelMode: 'force_jailbreak',
      title: 'cloned conversation',
    });
    const clonedConversationId = cloneResult.conversationId;
    conversationIds.push(clonedConversationId);

    const clonedConversation = await getConversationById(clonedConversationId, userId);
    assert.ok(clonedConversation, 'cloned conversation should be visible to owner');
    assert.equal(clonedConversation.selected_model_mode, 'force_jailbreak', 'clone should preserve selected model mode');
    assert.equal(Number(clonedConversation.current_message_id), Number(cloneResult.leafMessageId), 'clone current leaf should point to cloned leaf');

    const fallbackConversationId = await createConversation(userId, characterId, {
      title: 'fallback model conversation',
      selectedModelMode: 'standard',
    });
    conversationIds.push(fallbackConversationId);
    const fallbackConversation = await getConversationById(fallbackConversationId, userId);
    assert.ok(fallbackConversation, 'fallback conversation should be visible to owner');
    assert.notEqual(fallbackConversation.selected_model_mode, '', 'model fallback should keep a non-empty mode');

    console.log('Conversation service regression test passed.');
  } finally {
    for (const conversationId of conversationIds) {
      await query('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
      await query('DELETE FROM conversations WHERE id = ?', [conversationId]);
    }
    if (sourceConversationId) {
      await query('DELETE FROM messages WHERE conversation_id = ?', [sourceConversationId]);
      await query('DELETE FROM conversations WHERE id = ?', [sourceConversationId]);
    }
    await query('DELETE FROM characters WHERE id = ?', [characterId]);
    await query('DELETE FROM users WHERE id = ?', [userId]);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
