/**
 * @file scripts/test-admin-logs-route.js
 * @description 管理后台日志页模板冒烟测试。调用说明：`npm run admin-logs:test`，验证日志查询结果能正常渲染为后台 UI。
 */

const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const { listLogEntries } = require('../src/services/log-service');
const { translate } = require('../src/i18n');

async function main() {
  const logResult = listLogEntries({ page: 1, pageSize: 3 });
  const t = (key, vars) => translate('zh-CN', key, vars);
  const html = await ejs.renderFile(path.join(process.cwd(), 'src/views/admin-logs.ejs'), {
    logResult,
    buildPageUrl: (page) => `/admin/logs?page=${page}`,
    t,
  });

  assert.ok(html.includes('日志查询'), 'admin logs view should render title');
  assert.ok(html.includes('筛选条件'), 'admin logs view should render filters');
  assert.ok(html.includes('日志列表'), 'admin logs view should render result list');
  assert.ok(html.includes('等级'), 'admin logs view should render level filter');
  assert.ok(html.includes('文件报错'), 'admin logs view should render file filter');
  assert.ok(html.includes('类型报错'), 'admin logs view should render error type filter');
  assert.ok(html.includes('函数报错'), 'admin logs view should render function filter');

  console.log('Admin logs view test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
