/**
 * @file scripts/test-admin-conversations.js
 * @description 后台全局对话记录查询冒烟测试。调用说明：`npm run admin-conversations:test`，验证服务查询、筛选和 EJS 模板渲染。
 */

const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const { listAdminConversations, getAdminConversationDetail } = require('../src/services/admin-conversation-service');

async function main() {
  const result = await listAdminConversations({ page: 1, pageSize: 5 });
  assert.ok(Array.isArray(result.conversations), 'conversations should be array');
  assert.ok(result.conversations.length <= 5, 'pageSize should be respected');
  assert.ok(result.filterOptions && Array.isArray(result.filterOptions.users), 'users filter options should exist');
  assert.ok(result.filterOptions && Array.isArray(result.filterOptions.characters), 'characters filter options should exist');

  const html = await ejs.renderFile(path.join(process.cwd(), 'src/views/admin-conversations.ejs'), {
    conversationResult: result,
    buildPageUrl: (page) => `/admin/conversations?page=${page}`,
  });
  assert.ok(html.includes('全局对话记录'), 'list view should render title');
  assert.ok(html.includes('角色卡'), 'list view should render character filter');
  assert.ok(html.includes('用户'), 'list view should render user filter');
  assert.ok(html.includes('日期'), 'list view should render date filter');

  if (result.conversations.length) {
    const detail = await getAdminConversationDetail(result.conversations[0].id);
    assert.ok(detail && detail.conversation, 'detail should load existing conversation');
    const detailHtml = await ejs.renderFile(path.join(process.cwd(), 'src/views/admin-conversation-detail.ejs'), { detail });
    assert.ok(detailHtml.includes('完整消息链'), 'detail view should render message list title');
  }

  console.log('Admin conversations test passed.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
