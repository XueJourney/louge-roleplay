/**
 * @file scripts/check-i18n-completeness.js
 * @description 检查楼阁项目 i18n 词典是否覆盖已登记 key，并扫描页面/前端脚本残留中文文案，帮助持续补全国际化。
 * 调用说明：npm run i18n:check。脚本只读文件，发现缺失时以非 0 退出。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ZH_MESSAGES } = require('../src/i18n/messages.zh-CN');
const { EN_MESSAGES } = require('../src/i18n/messages.en');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['src/views', 'public/js'];
const TEXT_FILE_EXTENSIONS = new Set(['.ejs', '.js']);
const ZH_RE = /[\u4e00-\u9fff]/;

const IGNORE_LITERAL_PATTERNS = [
  /^\s*<!--/,
  /^\s*\*/,
  /^@file\b/,
  /^@description\b/,
  /^调用说明[：:]/,
  /^DEBUG[：:]/,
  /^eslint\b/,
  /^use strict$/,
  /^https?:\/\//,
  /^<%=\s*t\(/,
  /^\$\{\s*t\(/,
  /^<%=.*\?\s*'/,
  /^return confirm\(<%=\s*t\(/,
  /^return confirm\('<%=\s*t\(/,
  /^return confirm\(/,
  /^refreshCaptcha\(window\.AI_ROLEPLAY_I18N\.t\(/,
  /<[^>]+>/,
  /\$\{[^}]+\}/,
  /`【\[/,
];

function walk(dir, output = []) {
  const absDir = path.join(ROOT, dir);
  if (!fs.existsSync(absDir)) return output;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(path.relative(ROOT, absPath), output);
    } else if (TEXT_FILE_EXTENSIONS.has(path.extname(entry.name))) {
      output.push(absPath);
    }
  }
  return output;
}

function shouldIgnoreLiteral(value) {
  const text = String(value || '').trim();
  if (!text || !ZH_RE.test(text)) return true;
  return IGNORE_LITERAL_PATTERNS.some((pattern) => pattern.test(text));
}

function isInsideTCall(line, index) {
  const before = String(line || '').slice(0, index);
  return /(?:\bt|window\.AI_ROLEPLAY_I18N\.t)\(\s*$/.test(before);
}

function normalizeLiteral(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function collectTKeys() {
  const keys = new Set();
  const locations = new Map();
  const files = SCAN_ROOTS.flatMap((dir) => walk(dir));
  const callRe = /\bt\(\s*(['"`])([\s\S]*?)\1/g;

  for (const file of files) {
    const relative = path.relative(ROOT, file);
    const content = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = callRe.exec(content))) {
      const key = match[2];
      if (/[${]/.test(key)) continue;
      keys.add(key);
      const line = content.slice(0, match.index).split('\n').length;
      if (!locations.has(key)) locations.set(key, []);
      locations.get(key).push(`${relative}:${line}`);
    }
  }

  return { keys, locations };
}

function collectChineseLiterals() {
  const literals = new Map();
  const files = SCAN_ROOTS.flatMap((dir) => walk(dir));

  function add(value, file, line, kind) {
    const text = normalizeLiteral(value);
    if (shouldIgnoreLiteral(text)) return;
    if (!literals.has(text)) literals.set(text, []);
    literals.get(text).push(`${path.relative(ROOT, file)}:${line}:${kind}`);
  }

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let inHtmlComment = false;
    lines.forEach((rawLine, index) => {
      const lineNo = index + 1;
      let line = rawLine;
      if (line.includes('<!--')) inHtmlComment = true;
      if (inHtmlComment) {
        if (line.includes('-->')) inHtmlComment = false;
        return;
      }

      const noEjs = line.replace(/<%[\s\S]*?%>/g, '');
      let match;
      const textRe = />\s*([^<>]*?[\u4e00-\u9fff][^<>]*?)\s*</g;
      while ((match = textRe.exec(noEjs))) add(match[1], file, lineNo, 'text');

      const attrRe = /\b(?:placeholder|title|alt|aria-label|value)=(['"])(.*?)\1/g;
      while ((match = attrRe.exec(line))) add(match[2], file, lineNo, 'attr');

      const strRe = /(?:^|[^\\])(['"`])((?:\\.|(?!\1).)*?[\u4e00-\u9fff](?:\\.|(?!\1).)*?)\1/g;
      while ((match = strRe.exec(line))) {
        const quoteIndex = match.index + match[0].lastIndexOf(match[1]);
        if (isInsideTCall(line, quoteIndex)) continue;
        add(match[2], file, lineNo, 'str');
      }
    });
  }

  return literals;
}

function printList(title, items, details) {
  if (!items.length) return;
  console.error(`\n${title} (${items.length})`);
  for (const item of items) {
    console.error(`- ${item}`);
    const itemDetails = details?.get?.(item) || [];
    itemDetails.slice(0, 3).forEach((line) => console.error(`  ${line}`));
  }
}

function main() {
  const zhKeys = new Set(Object.keys(ZH_MESSAGES));
  const enKeys = new Set(Object.keys(EN_MESSAGES));
  const { keys: usedKeys, locations } = collectTKeys();
  const literals = collectChineseLiterals();

  const missingEnForZh = [...zhKeys].filter((key) => !enKeys.has(key)).sort();
  const missingZhForEn = [...enKeys].filter((key) => !zhKeys.has(key)).sort();
  const missingUsedEn = [...usedKeys].filter((key) => !enKeys.has(key)).sort();
  const missingUsedZh = [...usedKeys].filter((key) => !zhKeys.has(key)).sort();
  const untranslatedLiterals = [...literals.keys()].filter((text) => !enKeys.has(text)).sort((a, b) => a.localeCompare(b, 'zh-CN'));

  console.log(`i18n summary: zh=${zhKeys.size}, en=${enKeys.size}, usedTKeys=${usedKeys.size}, chineseLiterals=${literals.size}`);
  printList('Missing English entries for zh-CN dictionary keys', missingEnForZh);
  printList('Missing zh-CN entries for English dictionary keys', missingZhForEn);
  printList('Used t(...) keys missing English entries', missingUsedEn, locations);
  printList('Used t(...) keys missing zh-CN entries', missingUsedZh, locations);
  printList('Chinese literals/text not covered by English dictionary', untranslatedLiterals, literals);

  const failed = missingEnForZh.length || missingUsedEn.length || untranslatedLiterals.length;
  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log('i18n completeness check passed.');
}

main();
