/**
 * @file scripts/test-log-service.js
 * @description 日志解析服务冒烟测试。调用说明：`npm run logs:test`，用于确认后台日志分页/筛选基础逻辑可用。
 */

const assert = require('assert');
const { listLogEntries } = require('../src/services/log-service');

const result = listLogEntries({ page: 1, pageSize: 5 });
assert.ok(Array.isArray(result.entries), 'entries should be array');
assert.ok(result.page >= 1, 'page should be positive');
assert.ok(result.totalPages >= 1, 'totalPages should be positive');
assert.ok(result.entries.length <= 5, 'pageSize should be respected');
assert.ok(Array.isArray(result.levels) && result.levels.includes('error'), 'levels should include error');

const errorResult = listLogEntries({ level: 'error', page: 1, pageSize: 5 });
assert.ok(errorResult.entries.every((entry) => entry.level === 'error'), 'level filter should only return errors');

console.log('Log service test passed.');
