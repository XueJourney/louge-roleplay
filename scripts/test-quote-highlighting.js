#!/usr/bin/env node
/**
 * @file scripts/test-quote-highlighting.js
 * @description Smoke test for chat quote highlighting match collection.
 */

'use strict';

const assert = require('assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/js/chat/rich-renderer/sanitizer.js', 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'sanitizer.js' });

const { collectQuoteMatches } = context.window.ChatRichRenderer;

const manyQuotes = '他说 "第一句"，停了一下，接着 "第二句"，又写下 “第三句”，最后补充「第四句」。';
assert.deepEqual(
  Array.from(collectQuoteMatches(manyQuotes), (match) => match.text),
  ['"第一句"', '"第二句"', '“第三句”', '「第四句」'],
  'multiple quotes in one long text node should all match',
);

const longQuote = `开头 ${'铺垫'.repeat(120)} "${'长内容'.repeat(120)}" 结尾 "短句"`;
assert.equal(collectQuoteMatches(longQuote).length, 2, 'long quoted segments should still be highlighted');


const mixedQuotes = `混用 “中文开英文关"，还有 "英文开中文关”，单引号 ‘中文开英文关'，以及 '英文开中文关’。`;
assert.deepEqual(
  Array.from(collectQuoteMatches(mixedQuotes), (match) => match.text),
  ['“中文开英文关"', '"英文开中文关”', "‘中文开英文关'", "'英文开中文关’"],
  'mixed quote pairs should match within the same quote family',
);

const adjacentMixedQuotes = '"123”123“123"';
assert.deepEqual(
  Array.from(collectQuoteMatches(adjacentMixedQuotes), (match) => match.text),
  ['"123”', '“123"'],
  'adjacent mixed double quote pairs should match separately',
);

const htmlEscaped = '她说 &quot;HTML 转义双引号&quot;，然后说 &#39;HTML 转义单引号&#39;。';
assert.deepEqual(
  Array.from(collectQuoteMatches(htmlEscaped), (match) => match.text),
  ['&quot;HTML 转义双引号&quot;', '&#39;HTML 转义单引号&#39;'],
  'HTML-escaped quotes should match',
);

console.log(JSON.stringify({ status: 'passed', checks: ['multiple quotes', 'long quotes', 'mixed quotes', 'escaped quotes'] }, null, 2));
