#!/usr/bin/env node
/**
 * @file scripts/full-flow-e2e.js
 * @description
 * 全流程 E2E：直接调用项目服务层和核心路由依赖，验证用户、角色、会话、消息、LLM fallback、日志、后台只读查询。
 *
 * 设计原则：
 * - 不依赖 git，不读取提交状态。
 * - 使用唯一测试数据；测试结束尽量清理新增记录。
 * - 如果没有可用 LLM provider，会覆盖 getActiveProvider 为 null，验证系统 fallback 回复路径。
 */

'use strict';

const assert = require('assert/strict');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { waitReady, query } = require('../src/lib/db');
const { initRedis } = require('../src/lib/redis');
const { hashPassword, verifyPassword } = require('../src/services/password-service');
const { createUser, findUserByUsername, findUserByLogin } = require('../src/services/user-service');
const { getUserQuotaSnapshot } = require('../src/services/plan-service');
const { createCharacter, updateCharacter, getCharacterById, listUserCharacters, deleteCharacterSafely } = require('../src/services/character-service');
const { buildCharacterPromptProfileFromForm, renderChatPage } = require('../src/server-helpers');
const {
  createConversation,
  getConversationById,
  addMessage,
  getMessageById,
  setConversationCurrentMessage,
  fetchPathMessages,
  buildConversationPathView,
  createEditedMessageVariant,
  cloneConversationBranch,
  deleteMessageSafely,
  deleteConversationSafely,
} = require('../src/services/conversation-service');
const { streamReplyViaGateway, streamOptimizeUserInputViaGateway, getChatModelSelector } = require('../src/services/llm-gateway-service');
const { listLogEntries, appendDailyLog } = require('../src/services/log-service');
const { getAdminOverview, listUsersWithPlans } = require('../src/services/admin-service');
const { listAdminConversations, getAdminConversationDetail } = require('../src/services/admin-conversation-service');

const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const username = `e2e_${suffix}`;
const password = `E2ePass!${suffix}`;
const cleanup = {
  userId: null,
  characterIds: [],
  conversationIds: [],
};

function makeMockResponse() {
  const res = {
    locals: {
      locale: 'zh-CN',
      currentUser: { id: cleanup.userId, username, role: 'user' },
      t: (text) => text,
      clientI18nMessages: {},
      localeSwitchLinks: { 'zh-CN': '?lang=zh-CN', en: '?lang=en' },
    },
    statusCode: 200,
    redirectedTo: '',
    rendered: null,
    redirect(location) {
      this.redirectedTo = location;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, params, callback) {
      this.rendered = { view, params };
      if (typeof callback === 'function') callback(null, '<html>ok</html>');
      return this;
    },
    type() { return this; },
    send() { return this; },
  };
  return res;
}

async function cleanupCreatedData() {
  for (const conversationId of [...cleanup.conversationIds].reverse()) {
    try {
      await query('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
      await query('DELETE FROM conversations WHERE id = ?', [conversationId]);
    } catch (_) {}
  }
  for (const characterId of [...cleanup.characterIds].reverse()) {
    try {
      await query('DELETE FROM characters WHERE id = ?', [characterId]);
    } catch (_) {}
  }
  if (cleanup.userId) {
    try { await query('DELETE FROM llm_usage_logs WHERE user_id = ?', [cleanup.userId]); } catch (_) {}
    try { await query('DELETE FROM llm_jobs WHERE user_id = ?', [cleanup.userId]); } catch (_) {}
    try { await query('DELETE FROM user_subscriptions WHERE user_id = ?', [cleanup.userId]); } catch (_) {}
    try { await query('DELETE FROM users WHERE id = ?', [cleanup.userId]); } catch (_) {}
  }
}

async function main() {
  await waitReady();
  await initRedis();

  const passwordHash = await hashPassword(password);
  assert.equal(await verifyPassword(password, passwordHash), true, 'password hash/verify should work');

  const userId = await createUser({
    username,
    passwordHash,
    email: `${username}@gmail.com`,
    countryType: 'international',
    emailVerified: 1,
  });
  cleanup.userId = userId;
  const user = await findUserByUsername(username);
  assert.equal(Number(user.id), Number(userId), 'created user should be queryable');
  const loginUser = await findUserByLogin(username);
  assert.equal(Number(loginUser.id), Number(userId), 'login lookup should find user');

  const quota = await getUserQuotaSnapshot(userId);
  assert.ok(quota.subscription, 'created user should get default subscription');

  const promptItems = buildCharacterPromptProfileFromForm({
    name: 'E2E 角色',
    summary: '端到端测试角色',
    role: '你是一个用于测试的角色。',
    traitDescription: '稳定、简洁，会回应测试消息。',
    currentScene: '测试环境',
    currentBackground: '需要验证角色创建和聊天链路',
    extraPromptItemKey: ['额外规则'],
    extraPromptItemValue: ['输出不要太长'],
    extraPromptItemEnabled: ['1'],
  });
  assert.ok(promptItems.some((item) => item.key === '角色'), 'prompt profile should include structured role');

  const characterId = await createCharacter(userId, {
    name: `E2E角色-${suffix}`,
    summary: '端到端测试角色',
    personality: '稳定、简洁',
    firstMessage: '你好，{user}。现在是 {time}，我们开始测试。',
    promptProfileJson: JSON.stringify(promptItems),
    visibility: 'private',
  });
  cleanup.characterIds.push(characterId);
  const character = await getCharacterById(characterId, userId);
  assert.equal(character.visibility, 'private', 'character visibility should be private');

  await updateCharacter(characterId, userId, {
    name: `E2E角色-${suffix}-已编辑`,
    summary: '编辑后的端到端测试角色',
    personality: '更稳定、仍简洁',
    firstMessage: '编辑后的开场白，{user}。',
    promptProfileJson: JSON.stringify(promptItems),
    visibility: 'public',
  });
  const editedCharacter = await getCharacterById(characterId, userId);
  assert.equal(editedCharacter.visibility, 'public', 'character edit should update visibility');
  const ownedCharacters = await listUserCharacters(userId);
  assert.ok(ownedCharacters.some((item) => Number(item.id) === Number(characterId)), 'dashboard character list should include test character');

  const conversationId = await createConversation(userId, characterId, {
    title: 'E2E 测试会话',
    selectedModelMode: 'standard',
  });
  cleanup.conversationIds.push(conversationId);
  const seedUserId = await addMessage({ conversationId, senderType: 'user', content: '[开始一次新的对话]', promptKind: 'conversation-start' });
  const seedCharacterId = await addMessage({ conversationId, senderType: 'character', content: '编辑后的开场白，测试用户。', parentMessageId: seedUserId, branchFromMessageId: seedUserId, promptKind: 'conversation-start' });
  await setConversationCurrentMessage(conversationId, seedCharacterId);

  const userMessageId = await addMessage({ conversationId, senderType: 'user', content: '请简单回复一次全流程测试。', parentMessageId: seedCharacterId, promptKind: 'chat' });
  const messagesBeforeReply = await fetchPathMessages(conversationId, userMessageId);
  assert.ok(messagesBeforeReply.length >= 3, 'conversation path should have seed and user messages');

  let replyDelta = '';
  const replyResult = await streamReplyViaGateway({
    requestId: `e2e-${suffix}`,
    userId,
    conversationId,
    character: editedCharacter,
    messages: messagesBeforeReply,
    userMessage: '请简单回复一次全流程测试。',
    user,
    onDelta(delta) { replyDelta += delta; },
  });
  assert.ok(replyResult.content.length > 0, 'LLM stream should return content');
  const replyMessageId = await addMessage({ conversationId, senderType: 'character', content: replyResult.content, parentMessageId: userMessageId, branchFromMessageId: userMessageId, promptKind: 'chat' });
  await setConversationCurrentMessage(conversationId, replyMessageId);

  const optimized = await streamOptimizeUserInputViaGateway({
    requestId: `e2e-opt-${suffix}`,
    userId,
    conversationId,
    character: editedCharacter,
    messages: await fetchPathMessages(conversationId, replyMessageId),
    userInput: '帮我把这句改自然。',
    user,
  });
  assert.ok(optimized.content.length > 0, 'optimize stream should return content');
  const pathMessages = await fetchPathMessages(conversationId, replyMessageId);
  const view = await buildConversationPathView(conversationId, replyMessageId);
  assert.ok(pathMessages.length >= 4, 'path messages should include full chain');
  assert.equal(Number(view.activeLeafId), Number(replyMessageId), 'conversation path view should mark active leaf');
  const loadedReply = await getMessageById(conversationId, replyMessageId);
  assert.equal(Number(loadedReply.id), Number(replyMessageId), 'message lookup should work');

  const editedUserMessageId = await createEditedMessageVariant(conversationId, userMessageId, '这是编辑后的用户消息。');
  assert.ok(editedUserMessageId, 'edited message variant should be created');

  const branchResult = await cloneConversationBranch({
    userId,
    characterId,
    sourceConversationId: conversationId,
    sourceLeafMessageId: replyMessageId,
    selectedModelMode: 'standard',
    title: 'E2E 分支会话',
  });
  const branchConversationId = branchResult.conversationId;
  cleanup.conversationIds.push(branchConversationId);
  const branch = await getConversationById(branchConversationId, userId);
  assert.equal(Number(branch.parent_conversation_id), Number(conversationId), 'branch conversation should point to parent');

  const chatSelector = await getChatModelSelector(userId);
  assert.ok(Array.isArray(chatSelector.options), 'chat model selector should return options array');

  const req = {
    params: { conversationId: String(conversationId) },
    query: { leaf: String(replyMessageId) },
    session: { user: { id: userId, username, role: 'user' } },
    requestId: `e2e-render-${suffix}`,
    t: (text) => text,
  };
  const res = makeMockResponse();
  const conversationForRender = await getConversationById(conversationId, userId);
  await renderChatPage(req, res, conversationForRender);
  assert.equal(res.rendered?.view, 'layout', 'renderChatPage should render layout');

  const overview = await getAdminOverview();
  assert.ok(Number.isFinite(overview.totalUsers), 'admin overview should load');
  const usersWithPlans = await listUsersWithPlans();
  assert.ok(usersWithPlans.some((item) => Number(item.id) === Number(userId)), 'admin users list should include test user');
  const adminConversations = await listAdminConversations({ userId, pageSize: 10 });
  assert.ok(adminConversations.conversations.some((item) => Number(item.id) === Number(conversationId)), 'admin conversation list should include test conversation');
  const adminDetail = await getAdminConversationDetail(conversationId);
  assert.ok(adminDetail.messages.length >= 4, 'admin conversation detail should include messages');

  appendDailyLog('app', `[${new Date().toISOString()}] [INFO] E2E full flow marker {"requestId":"e2e-log-${suffix}"}`);
  const logs = listLogEntries({ query: `e2e-log-${suffix}`, pageSize: 5 });
  assert.ok(logs.entries.length >= 1, 'log query should find appended marker');

  await deleteMessageSafely(conversationId, editedUserMessageId, userId);
  await deleteConversationSafely(branchConversationId, userId);
  const deletedBranch = await getConversationById(branchConversationId, userId);
  assert.equal(deletedBranch, null, 'branch conversation should be deletable');
  cleanup.conversationIds = cleanup.conversationIds.filter((id) => Number(id) !== Number(branchConversationId));

  let protectedDelete = false;
  try {
    await deleteCharacterSafely(characterId, userId);
  } catch (error) {
    protectedDelete = error.code === 'CHARACTER_HAS_CONVERSATIONS';
  }
  assert.equal(protectedDelete, true, 'character with conversations should be protected from deletion');

  console.log(JSON.stringify({
    status: 'passed',
    userId,
    characterId,
    conversationId,
    branchConversationId,
    checks: [
      'db/redis ready',
      'password + user + default plan',
      'character create/edit/list',
      'conversation/message tree',
      'LLM stream reply + optimize',
      'chat page render',
      'admin overview/conversations/logs',
      'safe delete protections',
    ],
  }, null, 2));
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupCreatedData();
    process.exit(process.exitCode || 0);
  });
