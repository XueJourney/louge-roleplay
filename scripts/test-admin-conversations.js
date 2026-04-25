/**
 * @file scripts/test-admin-conversations.js
 * @description 后台全局对话记录查询冒烟测试。调用说明：`npm run admin-conversations:test`，验证服务查询、筛选和 EJS 模板渲染。
 */

const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const { query } = require('../src/lib/db');
const {
  listAdminConversations,
  getAdminConversationDetail,
  permanentlyDeleteConversation,
  restoreConversation,
  restoreMessage,
} = require('../src/services/admin-conversation-service');
const {
  createConversation,
  addMessage,
  deleteConversationSafely,
  deleteMessageSafely,
  getConversationById,
  listMessages,
} = require('../src/services/conversation-service');
const { translate } = require('../src/i18n');

async function main() {
  const result = await listAdminConversations({ page: 1, pageSize: 5 });
  assert.ok(Array.isArray(result.conversations), 'conversations should be array');
  assert.ok(result.conversations.length <= 5, 'pageSize should be respected');
  assert.ok(result.filterOptions && Array.isArray(result.filterOptions.users), 'users filter options should exist');
  assert.ok(result.filterOptions && Array.isArray(result.filterOptions.characters), 'characters filter options should exist');

  const t = (key, vars) => translate('zh-CN', key, vars);
  const html = await ejs.renderFile(path.join(process.cwd(), 'src/views/admin-conversations.ejs'), {
    conversationResult: result,
    buildPageUrl: (page) => `/admin/conversations?page=${page}`,
    t,
  });
  assert.ok(html.includes('全局对话记录'), 'list view should render title');
  assert.ok(html.includes('角色卡'), 'list view should render character filter');
  assert.ok(html.includes('用户'), 'list view should render user filter');
  assert.ok(html.includes('日期'), 'list view should render date filter');

  if (result.conversations.length) {
    const detail = await getAdminConversationDetail(result.conversations[0].id);
    assert.ok(detail && detail.conversation, 'detail should load existing conversation');
    const detailHtml = await ejs.renderFile(path.join(process.cwd(), 'src/views/admin-conversation-detail.ejs'), { detail, t });
    assert.ok(detailHtml.includes('完整消息链'), 'detail view should render message list title');
  }

  const suffix = Date.now();
  const userRow = await query(
    `INSERT INTO users (username, password_hash, role, status, created_at, updated_at)
     VALUES (?, 'test', 'user', 'active', NOW(), NOW())`,
    [`admin_deleted_${suffix}`],
  );
  const userId = userRow.insertId;
  const characterRow = await query(
    `INSERT INTO characters (user_id, name, summary, visibility, status, created_at, updated_at)
     VALUES (?, ?, 'admin deleted render test', 'private', 'published', NOW(), NOW())`,
    [userId, `后台删除测试角色 ${suffix}`],
  );
  const characterId = characterRow.insertId;
  const conversationId = await createConversation(userId, characterId, { title: '后台删除测试会话' });
  const messageId = await addMessage({ conversationId, senderType: 'user', content: 'soft deleted message', promptKind: 'normal' });

  try {
    await deleteMessageSafely(conversationId, messageId, userId);
    await deleteConversationSafely(conversationId, userId);

    const deletedResult = await listAdminConversations({ status: 'deleted', page: 1, pageSize: 25 });
    assert.ok(deletedResult.conversations.some((item) => Number(item.id) === Number(conversationId)), 'deleted status filter should include soft deleted conversation');
    const deletedListHtml = await ejs.renderFile(path.join(process.cwd(), 'src/views/admin-conversations.ejs'), {
      conversationResult: deletedResult,
      buildPageUrl: (page) => `/admin/conversations?status=deleted&page=${page}`,
      t,
    });
    assert.ok(deletedListHtml.includes('恢复会话'), 'deleted list should render restore conversation button');
    assert.ok(deletedListHtml.includes('永久删除'), 'deleted list should render permanent delete button');

    const deletedDetail = await getAdminConversationDetail(conversationId);
    assert.ok(deletedDetail.messages.some((message) => Number(message.id) === Number(messageId) && message.deleted_at), 'admin detail should include soft deleted message');
    const deletedDetailHtml = await ejs.renderFile(path.join(process.cwd(), 'src/views/admin-conversation-detail.ejs'), { detail: deletedDetail, t });
    assert.ok(deletedDetailHtml.includes('恢复会话'), 'deleted detail should render restore conversation button');
    assert.ok(deletedDetailHtml.includes('恢复消息'), 'deleted detail should render restore message button');
    assert.ok(deletedDetailHtml.includes('永久删除'), 'deleted detail should render permanent delete button');

    await restoreMessage(conversationId, messageId);
    assert.ok((await listMessages(conversationId)).some((message) => Number(message.id) === Number(messageId)), 'restore message should invalidate cache and restore visibility');
    await restoreConversation(conversationId);
    assert.ok(await getConversationById(conversationId, userId), 'restore conversation should make conversation visible to owner');
    await deleteConversationSafely(conversationId, userId);
    assert.ok(await permanentlyDeleteConversation(conversationId), 'permanent delete should remove soft deleted conversation');
  } finally {
    await query('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
    await query('DELETE FROM conversations WHERE id = ?', [conversationId]);
    await query('DELETE FROM characters WHERE id = ?', [characterId]);
    await query('DELETE FROM users WHERE id = ?', [userId]);
  }

  console.log('Admin conversations test passed.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
