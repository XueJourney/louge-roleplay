#!/usr/bin/env node
/**
 * @file scripts/test-markdown-service.js
 * @description Smoke test for safe Markdown rendering in notifications and site mail.
 */

'use strict';

const assert = require('assert/strict');
const { markdownToHtml } = require('../src/services/markdown-service');

const html = markdownToHtml(`# 标题

**加粗** 和 *斜体*，还有 [链接](https://example.com/path?q=1)。

- 第一条
- 第二条

> 引用内容

\`inline\`

\`\`\`js
console.log('<safe>');
\`\`\`

<script>alert(1)</script>
<img src=x onerror=alert(1)>
`);

assert.match(html, /<h1>标题<\/h1>/, 'heading should render');
assert.match(html, /<strong>加粗<\/strong>/, 'bold should render');
assert.match(html, /<em>斜体<\/em>/, 'italic should render');
assert.match(html, /<a href="https:\/\/example\.com\/path\?q=1"/, 'safe links should render');
assert.match(html, /<ul><li>第一条<\/li><li>第二条<\/li><\/ul>/, 'lists should render');
assert.match(html, /<blockquote>引用内容<\/blockquote>/, 'blockquote should render');
assert.match(html, /<pre><code class="lang-js">/, 'code fence should render');

const tableHtml = markdownToHtml(`| 项目 | 状态 | 数量 |
| --- | :---: | ---: |
| **表格** | 支持 | \`3\` |
| 转义 | a\\|b | 2 |`);
assert.match(tableHtml, /<table><thead><tr><th>项目<\/th><th class="align-center">状态<\/th><th class="align-right">数量<\/th><\/tr><\/thead>/, 'table header should render');
assert.match(tableHtml, /<tbody><tr><td><strong>表格<\/strong><\/td><td class="align-center">支持<\/td><td class="align-right"><code>3<\/code><\/td><\/tr>/, 'table body should render inline markdown');
assert.match(tableHtml, /<td class="align-center">a\|b<\/td>/, 'escaped pipes should stay inside table cells');
assert.doesNotMatch(html, /<script>/i, 'raw script tags must be escaped');
assert.doesNotMatch(html, /<img src=x onerror=/i, 'raw image tags must not become real HTML');
assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'raw HTML should stay visible as escaped text');

console.log(JSON.stringify({ status: 'passed', checks: ['markdown render', 'table render', 'html escaping', 'safe links'] }, null, 2));
