/**
 * @file src/services/tavern-import/card-payload.js
 * @description Normalize Tavern card JSON into Louge character fields and prompt items.
 */

'use strict';

const { parseTagInput } = require('../character-tag-service');
const { MAX_CHARACTER_FIELD_LENGTH, clampCharacterField } = require('../../constants/character-limits');
const { MAX_TEXT_FIELD } = require('./constants');
const {
  truncateText,
  normalizeExtensions,
  pickFirst,
  normalizeTavernTemplateText,
  joinSections,
  normalizeLineBreaks,
} = require('./text-utils');

const LOUGE_PROMPT_SOFT_LIMIT = 10000;
const MAX_PROMPT_ITEM_VALUE_LENGTH = MAX_TEXT_FIELD;

function truncateMiddle(text, maxLength) {
  const normalized = normalizeLineBreaks(text);
  const limit = Math.max(0, Number(maxLength || 0));
  if (!limit || normalized.length <= limit) return normalized;
  if (limit <= 32) return normalized.slice(0, limit);
  const marker = '\n……（已压缩，保留首尾关键信息）……\n';
  const side = Math.max(8, Math.floor((limit - marker.length) / 2));
  return `${normalized.slice(0, side)}${marker}${normalized.slice(-side)}`.slice(0, limit);
}

function createPromptItem(key, value, sortOrder, context = {}, options = {}) {
  const maxLength = Number(options.maxLength || MAX_PROMPT_ITEM_VALUE_LENGTH);
  const normalizedValue = truncateText(normalizeTavernTemplateText(value, context), maxLength);
  if (!normalizedValue) return null;
  return { key: clampCharacterField(key), value: normalizedValue, sortOrder, isEnabled: true };
}

function estimatePromptItemsLength(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .reduce((total, item) => total + String(item.key || '').length + String(item.value || '').length + 8, 0);
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

function formatWorldBookEntries(entries = [], options = {}) {
  const compressed = Boolean(options.compressed);
  const targetLength = Number(options.targetLength || 0);
  const header = compressed
    ? [
      '【世界书 / 背景资料（压缩版）】',
      '',
      '以下内容来自原酒馆卡世界书。楼阁当前不支持关键词触发式世界书，因此已将其压缩合并进角色设定中；关键词会作为阅读提示保留。',
      '',
    ]
    : [
      '【世界书 / 背景资料】',
      '',
      '以下内容来自原酒馆卡世界书。楼阁当前不支持关键词触发式世界书，因此已将其完整合并进角色设定中。',
      '',
    ];

  const availableForEntries = compressed && targetLength
    ? Math.max(600, targetLength - header.join('\n').length)
    : 0;
  const perEntryBudget = compressed && entries.length
    ? Math.max(120, Math.floor(availableForEntries / entries.length))
    : 0;

  const body = entries.map((entry, index) => {
    const metaLines = [
      `${index + 1}. 条目名称：${entry.name || `条目 ${index + 1}`}`,
      entry.keys.length ? `关键词：${entry.keys.join(', ')}` : '',
      entry.secondaryKeys.length ? `次级关键词：${entry.secondaryKeys.join(', ')}` : '',
      entry.enabled ? '' : '状态：原条目为停用，已随卡片一并保留。',
      '内容：',
    ].filter(Boolean);
    const metaLength = metaLines.join('\n').length + 2;
    const contentBudget = compressed ? Math.max(80, perEntryBudget - metaLength) : 0;
    const content = compressed ? truncateMiddle(entry.content, contentBudget) : entry.content;
    return [...metaLines, content].join('\n');
  });

  let text = [...header, ...body].join('\n');
  if (compressed && targetLength && text.length > targetLength) {
    text = truncateMiddle(text, targetLength);
  }
  return text;
}

function flattenWorldBooks(root, data, context = {}, options = {}) {
  const charName = String(context.charName || pickFirst(data.name, root.name, data.char_name, root.char_name)).trim();
  const rawBooks = findWorldBooks(root, data);
  const entries = rawBooks.flatMap((book) => normalizeWorldBookEntries(book, { charName }));
  if (!entries.length) {
    return { entries: [], text: '', raw: null, warning: '', compressed: false, originalLength: 0 };
  }

  const compressed = Boolean(options.compressed);
  const text = formatWorldBookEntries(entries, {
    compressed,
    targetLength: Number(options.targetLength || 0),
  });
  const originalText = compressed ? formatWorldBookEntries(entries, { compressed: false }) : text;
  return {
    entries,
    text: truncateText(text, 60000),
    raw: rawBooks,
    warning: compressed ? '世界书内容较长，已按楼阁 1 万字提示词软上限压缩后写入角色卡' : (text.length > LOUGE_PROMPT_SOFT_LIMIT ? '世界书内容较长，可能影响上下文' : ''),
    compressed,
    originalLength: originalText.length,
  };
}

function normalizeCardPayload(cardJson) {
  const root = cardJson && typeof cardJson === 'object' ? cardJson : {};
  const data = root.data && typeof root.data === 'object' ? root.data : root;
  const extensions = normalizeExtensions(data.extensions || root.extensions);
  const name = clampCharacterField(pickFirst(data.name, root.name, data.char_name, root.char_name));
  const templateContext = { charName: name };
  const description = normalizeTavernTemplateText(pickFirst(data.description, root.description, data.personality, root.personality), templateContext);
  const personality = normalizeTavernTemplateText(pickFirst(data.personality, root.personality), templateContext);
  const scenario = normalizeTavernTemplateText(pickFirst(data.scenario, root.scenario), templateContext);
  const mesExample = normalizeTavernTemplateText(pickFirst(data.mes_example, root.mes_example, data.example_dialogue, root.example_dialogue), templateContext);
  const creatorNotes = normalizeTavernTemplateText(pickFirst(data.creator_notes, root.creator_notes, data.creatorcomment, root.creatorcomment), templateContext);
  const systemPrompt = normalizeTavernTemplateText(pickFirst(data.system_prompt, root.system_prompt, extensions.system_prompt), templateContext);
  const postHistory = normalizeTavernTemplateText(pickFirst(data.post_history_instructions, root.post_history_instructions, extensions.post_history_instructions), templateContext);
  const firstMessage = normalizeTavernTemplateText(pickFirst(data.first_mes, root.first_mes, data.first_message, root.first_message), templateContext);
  const alternateGreetings = normalizeAlternateGreetings(root, data, templateContext);
  const summary = clampCharacterField(pickFirst(data.summary, root.summary, description));

  const basePromptItems = [
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
  ].filter(Boolean);

  let worldBook = flattenWorldBooks(root, data, templateContext);
  let worldBookItem = createPromptItem('世界书 / 背景资料', worldBook.text, 10, templateContext);
  const projectedPromptLength = estimatePromptItemsLength([...basePromptItems, worldBookItem]);
  if (worldBook.text && projectedPromptLength > LOUGE_PROMPT_SOFT_LIMIT) {
    const baseLength = estimatePromptItemsLength(basePromptItems);
    const worldBookBudget = Math.max(1200, LOUGE_PROMPT_SOFT_LIMIT - baseLength - 120);
    worldBook = flattenWorldBooks(root, data, templateContext, { compressed: true, targetLength: worldBookBudget });
    worldBookItem = createPromptItem('世界书 / 背景资料（压缩）', worldBook.text, 10, templateContext, { maxLength: Math.max(worldBookBudget, 1200) });
  }

  const promptItems = [...basePromptItems, worldBookItem].filter(Boolean);
  const finalPromptLength = estimatePromptItemsLength(promptItems);
  const personalityWithWorldBook = joinSections([personality || description, worldBook.text]);

  return {
    name: clampCharacterField(name),
    summary: summary || `${clampCharacterField(name) || '未命名角色'} · 酒馆卡导入`,
    personality: clampCharacterField(personalityWithWorldBook),
    firstMessage: clampCharacterField(firstMessage),
    promptProfileItems: promptItems,
    tags: collectTagsFromCard(root, data),
    sourceFormat: String(root.spec || root.spec_version || data.spec || data.spec_version || 'tavern-card').slice(0, 80),
    sourceCardJson: root,
    importedWorldBookJson: worldBook.raw,
    flattenedWorldBookText: worldBook.text,
    promptStats: {
      promptItemCount: promptItems.length,
      promptTextLength: finalPromptLength,
      worldBookEntryCount: worldBook.entries.length,
      worldBookOriginalLength: worldBook.originalLength,
      worldBookCompressed: worldBook.compressed,
      alternateGreetingCount: alternateGreetings.length,
      hasFirstMessage: Boolean(firstMessage),
    },
    warnings: [worldBook.warning, finalPromptLength > LOUGE_PROMPT_SOFT_LIMIT ? '压缩后提示词仍超过 1 万字，请人工复核' : '', name ? '' : '缺少角色名称，请手动填写'].filter(Boolean),
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
  estimatePromptItemsLength,
  LOUGE_PROMPT_SOFT_LIMIT,
};
