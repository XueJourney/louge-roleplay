/**
 * @file src/services/tavern-import/card-payload.js
 * @description Normalize Tavern card JSON into Louge character fields and prompt items.
 */

'use strict';

const { parseTagInput } = require('../character-tag-service');
const { MAX_TEXT_FIELD } = require('./constants');
const {
  truncateText,
  normalizeExtensions,
  pickFirst,
  normalizeLineBreaks,
  normalizeTavernTemplateText,
  joinSections,
} = require('./text-utils');

function createPromptItem(key, value, sortOrder, context = {}) {
  const normalizedValue = normalizeTavernTemplateText(value, context);
  if (!normalizedValue) return null;
  return { key, value: normalizedValue, sortOrder, isEnabled: true };
}

function normalizeAlternateGreetings(root, data, context = {}) {
  const candidates = [
    data.alternate_greetings,
    data.alternateGreetings,
    root.alternate_greetings,
    root.alternateGreetings,
    data.extensions?.alternate_greetings,
    data.extensions?.alternateGreetings,
    root.extensions?.alternate_greetings,
    root.extensions?.alternateGreetings,
  ];
  const greetings = [];
  candidates.forEach((candidate) => {
    if (Array.isArray(candidate)) greetings.push(...candidate);
    else if (typeof candidate === 'string') greetings.push(candidate);
  });
  return greetings
    .map((item) => normalizeTavernTemplateText(item, context))
    .filter(Boolean)
    .slice(0, 8);
}

function collectTagsFromCard(root, data) {
  const tags = [];
  const candidates = [data.tags, root.tags, data.extensions?.tags, root.extensions?.tags];
  candidates.forEach((candidate) => {
    if (Array.isArray(candidate)) tags.push(...candidate);
    else if (typeof candidate === 'string') tags.push(...candidate.split(/[，,\n]/g));
  });
  return parseTagInput(tags);
}

function normalizeWorldBookEntries(book, context = {}) {
  if (!book || typeof book !== 'object') return [];
  const rawEntries = Array.isArray(book.entries)
    ? book.entries
    : Object.values(book.entries || {});
  return rawEntries
    .map((entry, index) => {
      const keys = Array.isArray(entry.keys) ? entry.keys : Array.isArray(entry.key) ? entry.key : [];
      const secondaryKeys = Array.isArray(entry.secondary_keys) ? entry.secondary_keys : Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : [];
      return {
        index,
        name: pickFirst(entry.comment, entry.name, entry.title, `条目 ${index + 1}`),
        keys: keys.map((item) => normalizeTavernTemplateText(item, context)).filter(Boolean),
        secondaryKeys: secondaryKeys.map((item) => normalizeTavernTemplateText(item, context)).filter(Boolean),
        content: normalizeTavernTemplateText(pickFirst(entry.content, entry.entry, entry.text, entry.value), context),
        enabled: entry.enabled === undefined ? true : Boolean(entry.enabled),
        position: entry.position ?? entry.insertion_order ?? entry.order ?? null,
      };
    })
    .filter((entry) => entry.content);
}

function findWorldBooks(root, data) {
  const books = [];
  [data.character_book, root.character_book, data.world_book, root.world_book, data.extensions?.world_book, root.extensions?.world_book].forEach((book) => {
    if (book && typeof book === 'object') books.push(book);
  });
  if (Array.isArray(data.worlds)) books.push(...data.worlds.filter((item) => item && typeof item === 'object'));
  if (Array.isArray(root.worlds)) books.push(...root.worlds.filter((item) => item && typeof item === 'object'));
  return books;
}

function flattenWorldBooks(root, data, context = {}) {
  const charName = String(context.charName || pickFirst(data.name, root.name, data.char_name, root.char_name)).trim();
  const entries = findWorldBooks(root, data).flatMap((book) => normalizeWorldBookEntries(book, { charName }));
  if (!entries.length) {
    return { entries: [], text: '', raw: null, warning: '' };
  }
  const text = [
    '【世界书 / 背景资料】',
    '',
    '以下内容来自原酒馆卡世界书。楼阁当前不支持关键词触发式世界书，因此已将其完整合并进角色设定中。',
    '',
    ...entries.map((entry, index) => [
      `${index + 1}. 条目名称：${entry.name || `条目 ${index + 1}`}`,
      entry.keys.length ? `关键词：${entry.keys.join(', ')}` : '',
      entry.secondaryKeys.length ? `次级关键词：${entry.secondaryKeys.join(', ')}` : '',
      entry.enabled ? '' : '状态：原条目为停用，已随卡片一并保留。',
      '内容：',
      entry.content,
    ].filter(Boolean).join('\n')),
  ].join('\n');
  return {
    entries,
    text: truncateText(text, 60000),
    raw: findWorldBooks(root, data),
    warning: text.length > 12000 ? '世界书内容较长，可能影响上下文' : '',
  };
}

function normalizeCardPayload(cardJson) {
  const root = cardJson && typeof cardJson === 'object' ? cardJson : {};
  const data = root.data && typeof root.data === 'object' ? root.data : root;
  const extensions = normalizeExtensions(data.extensions || root.extensions);
  const name = pickFirst(data.name, root.name, data.char_name, root.char_name);
  const templateContext = { charName: name };
  const worldBook = flattenWorldBooks(root, data, templateContext);
  const description = normalizeTavernTemplateText(pickFirst(data.description, root.description, data.personality, root.personality), templateContext);
  const personality = normalizeTavernTemplateText(pickFirst(data.personality, root.personality), templateContext);
  const scenario = normalizeTavernTemplateText(pickFirst(data.scenario, root.scenario), templateContext);
  const mesExample = normalizeTavernTemplateText(pickFirst(data.mes_example, root.mes_example, data.example_dialogue, root.example_dialogue), templateContext);
  const creatorNotes = normalizeTavernTemplateText(pickFirst(data.creator_notes, root.creator_notes, data.creatorcomment, root.creatorcomment), templateContext);
  const systemPrompt = normalizeTavernTemplateText(pickFirst(data.system_prompt, root.system_prompt, extensions.system_prompt), templateContext);
  const postHistory = normalizeTavernTemplateText(pickFirst(data.post_history_instructions, root.post_history_instructions, extensions.post_history_instructions), templateContext);
  const firstMessage = normalizeTavernTemplateText(pickFirst(data.first_mes, root.first_mes, data.first_message, root.first_message), templateContext);
  const alternateGreetings = normalizeAlternateGreetings(root, data, templateContext);
  const summary = pickFirst(data.summary, root.summary, description).slice(0, 500);
  const personalityWithWorldBook = joinSections([personality || description, worldBook.text]);

  const promptItems = [
    createPromptItem('角色名', name, 0, templateContext),
    createPromptItem('角色简介', summary, 1, templateContext),
    createPromptItem('角色设定', description, 2, templateContext),
    createPromptItem('性格与行为', personality || description, 3, templateContext),
    createPromptItem('当前场景', scenario, 4, templateContext),
    createPromptItem('示例对话', mesExample, 5, templateContext),
    createPromptItem('系统提示词', systemPrompt, 6, templateContext),
    createPromptItem('后历史指令', postHistory, 7, templateContext),
    createPromptItem('创作者备注', creatorNotes, 8, templateContext),
    alternateGreetings.length ? createPromptItem('备用开场白', alternateGreetings.map((item, index) => `${index + 1}. ${item}`).join('\n\n'), 9, templateContext) : null,
    createPromptItem('世界书 / 背景资料', worldBook.text, 10, templateContext),
  ].filter(Boolean);

  return {
    name,
    summary: summary || `${name || '未命名角色'} · 酒馆卡导入`,
    personality: personalityWithWorldBook,
    firstMessage,
    promptProfileItems: promptItems,
    tags: collectTagsFromCard(root, data),
    sourceFormat: String(root.spec || root.spec_version || data.spec || data.spec_version || 'tavern-card').slice(0, 80),
    sourceCardJson: root,
    importedWorldBookJson: worldBook.raw,
    flattenedWorldBookText: worldBook.text,
    promptStats: {
      promptItemCount: promptItems.length,
      worldBookEntryCount: worldBook.entries.length,
      alternateGreetingCount: alternateGreetings.length,
      hasFirstMessage: Boolean(firstMessage),
    },
    warnings: [worldBook.warning, name ? '' : '缺少角色名称，请手动填写'].filter(Boolean),
  };
}


module.exports = {
  normalizeCardPayload,
  normalizeAlternateGreetings,
  collectTagsFromCard,
  normalizeWorldBookEntries,
  findWorldBooks,
  flattenWorldBooks,
  createPromptItem,
};
