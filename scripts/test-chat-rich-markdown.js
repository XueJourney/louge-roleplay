#!/usr/bin/env node
/**
 * @file scripts/test-chat-rich-markdown.js
 * @description Smoke test for the browser chat Markdown renderer.
 */

'use strict';

const assert = require('assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/js/chat/rich-renderer/formatting.js', 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'formatting.js' });

const { markdownToHtml, buildStreamingPreviewHtml } = context.window.ChatRichRenderer;
const html = markdownToHtml(`前文

| 名称 | 说明 | 数量 |
| --- | :---: | ---: |
| **角色** | 支持表格 | \`2\` |
| 转义 | a\\|b | 1 |

后文`);

assert.match(html, /<p>前文<\/p>/, 'paragraph before table should render');
assert.match(html, /<div class="bubble-table-wrap"><table><thead><tr><th>名称<\/th><th class="align-center">说明<\/th><th class="align-right">数量<\/th><\/tr><\/thead>/, 'table header should render');
assert.match(html, /<td><strong>角色<\/strong><\/td><td class="align-center">支持表格<\/td><td class="align-right"><code>2<\/code><\/td>/, 'table body should render inline markdown');
assert.match(html, /<td class="align-center">a\|b<\/td>/, 'escaped pipes should stay inside cells');
assert.match(html, /<p>后文<\/p>/, 'paragraph after table should render');
assert.doesNotMatch(markdownToHtml('普通 | 文本'), /<table>/, 'plain pipe text should not become a table');
assert.match(buildStreamingPreviewHtml('| A | B |\n| --- | --- |\n| 1 | 2 |'), /<table>/, 'streaming preview should render complete tables');

console.log(JSON.stringify({ status: 'passed', checks: ['chat markdown table render', 'escaped pipes', 'streaming preview'] }, null, 2));
