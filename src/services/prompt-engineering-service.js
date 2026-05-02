/**
 * @file src/services/prompt-engineering-service.js
 * @description 全局提示词片段、角色提示词片段与最终 system prompt 拼接。
 */

const { query } = require('../lib/db');

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [value];
}

function safeParseJson(value, fallback = []) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function normalizePromptItems(items = []) {
  return toArray(items)
    .map((item, index) => ({
      key: String(item?.key || item?.label || '').trim(),
      value: String(item?.value || '').trim(),
      sortOrder: Number(item?.sortOrder ?? item?.sort_order ?? index),
      isEnabled: item?.isEnabled === undefined ? true : Boolean(Number(item?.isEnabled ?? item?.is_enabled ?? 1)),
    }))
    .filter((item) => item.key || item.value)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, index) => ({
      ...item,
      sortOrder: index,
    }));
}

function parsePromptItemsFromForm(body, options = {}) {
  const keyField = options.keyField || 'promptItemKey';
  const valueField = options.valueField || 'promptItemValue';
  const enabledField = options.enabledField || 'promptItemEnabled';

  const keys = toArray(body[keyField]);
  const values = toArray(body[valueField]);
  const enabledValues = toArray(body[enabledField]);
  const maxLength = Math.max(keys.length, values.length, enabledValues.length);

  const items = [];
  for (let index = 0; index < maxLength; index += 1) {
    items.push({
      key: String(keys[index] || '').trim(),
      value: String(values[index] || '').trim(),
      isEnabled: String(enabledValues[index] || '1') !== '0',
      sortOrder: index,
    });
  }

  return normalizePromptItems(items);
}

function formatPromptSection(key, value) {
  const cleanKey = String(key || '').trim();
  const cleanValue = String(value || '').trim();
  if (!cleanValue) {
    return '';
  }
  if (!cleanKey) {
    return `【[未命名片段]】{\n${cleanValue}\n}`;
  }
  return `【[${cleanKey}]】{\n${cleanValue}\n}`;
}

function buildCharacterPromptItems(character = {}) {
  const dynamicItems = normalizePromptItems(safeParseJson(character.prompt_profile_json || character.promptProfileJson || '[]', []));
  if (dynamicItems.length > 0) {
    return dynamicItems;
  }

  return normalizePromptItems([
    { key: '角色名', value: character.name || '', sortOrder: 0 },
    { key: '角色简介', value: character.summary || '', sortOrder: 1 },
    { key: '角色', value: character.role || '', sortOrder: 2 },
    { key: '描述角色性格', value: character.personality || character.traitDescription || '', sortOrder: 3 },
    { key: '当前场景', value: character.currentScene || '', sortOrder: 4 },
    { key: '当前背景', value: character.currentBackground || '', sortOrder: 5 },
  ]);
}

function formatRuntimeTime(date = new Date(), options = {}) {
  const timeZone = String(options.timeZone || 'Asia/Hong_Kong').trim() || 'Asia/Hong_Kong';
  const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    dateFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  let timeZoneLabel = 'GMT+08:00';
  try {
    const zoneFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    });
    const timeZonePart = zoneFormatter.formatToParts(date).find((part) => part.type === 'timeZoneName');
    if (timeZonePart?.value) {
      timeZoneLabel = timeZonePart.value;
    }
  } catch (_) {
    // ignore timezone label formatting failure and keep fallback value
  }

  return `${parts.year || ''}年${parts.month || ''}月${parts.day || ''}日 ${parts.weekday || ''} ${parts.hour || '00'}:${parts.minute || '00'}:${parts.second || '00'} ${timeZoneLabel}`.trim();
}

function applyRuntimeTemplate(text, runtimeContext = {}) {
  const rawText = String(text || '');
  if (!rawText) {
    return '';
  }

  const username = String(runtimeContext.username || runtimeContext.user || '用户').trim() || '用户';
  const characterName = String(runtimeContext.characterName || runtimeContext.char || runtimeContext.character || '').trim();
  const timeValue = String(
    runtimeContext.time
      || formatRuntimeTime(runtimeContext.now instanceof Date ? runtimeContext.now : new Date(), {
        timeZone: runtimeContext.timeZone,
      }),
  ).trim();

  let rendered = rawText
    .replace(/{{\s*user\s*}}/gi, username)
    .replace(/\{\{\s*user\s*\}\}/gi, username)
    .replace(/\{user\}/gi, username)
    .replace(/<USER>/gi, username)
    .replace(/\{time\}/gi, timeValue)
    .replace(/{{\s*time\s*}}/gi, timeValue)
    .replace(/\{\{\s*time\s*\}\}/gi, timeValue);

  if (characterName) {
    rendered = rendered
      .replace(/{{\s*char\s*}}/gi, characterName)
      .replace(/\{\{\s*char\s*\}\}/gi, characterName)
      .replace(/\{char\}/gi, characterName)
      .replace(/<BOT>/gi, characterName);
  }

  return rendered;
}

function applyRuntimeTemplateToCharacter(character = {}, runtimeContext = {}) {
  const source = character && typeof character === 'object' ? character : {};
  const resolvedCharacterName = String(source.name || runtimeContext.characterName || runtimeContext.char || '').trim();
  const characterRuntimeContext = { ...runtimeContext, characterName: resolvedCharacterName, char: resolvedCharacterName };
  const nextCharacter = {
    ...source,
    name: applyRuntimeTemplate(source.name, characterRuntimeContext),
    summary: applyRuntimeTemplate(source.summary, characterRuntimeContext),
    role: applyRuntimeTemplate(source.role, characterRuntimeContext),
    personality: applyRuntimeTemplate(source.personality, characterRuntimeContext),
    traitDescription: applyRuntimeTemplate(source.traitDescription, characterRuntimeContext),
    currentScene: applyRuntimeTemplate(source.currentScene, characterRuntimeContext),
    currentBackground: applyRuntimeTemplate(source.currentBackground, characterRuntimeContext),
  };

  const firstMessageRaw = source.first_message === undefined ? source.firstMessage : source.first_message;
  const nextFirstMessage = applyRuntimeTemplate(firstMessageRaw, characterRuntimeContext);
  if (source.first_message !== undefined) {
    nextCharacter.first_message = nextFirstMessage;
  }
  if (source.firstMessage !== undefined) {
    nextCharacter.firstMessage = nextFirstMessage;
  }

  const promptProfileRaw = source.prompt_profile_json === undefined ? source.promptProfileJson : source.prompt_profile_json;
  const parsedPromptProfile = safeParseJson(promptProfileRaw, null);
  if (Array.isArray(parsedPromptProfile)) {
    const normalizedPromptProfile = normalizePromptItems(parsedPromptProfile).map((item) => ({
      ...item,
      key: applyRuntimeTemplate(item.key, characterRuntimeContext),
      value: applyRuntimeTemplate(item.value, characterRuntimeContext),
    }));
    const serializedPromptProfile = JSON.stringify(normalizedPromptProfile);
    if (source.prompt_profile_json !== undefined) {
      nextCharacter.prompt_profile_json = serializedPromptProfile;
    }
    if (source.promptProfileJson !== undefined) {
      nextCharacter.promptProfileJson = serializedPromptProfile;
    }
  }

  return nextCharacter;
}

function buildReplyLengthInstruction(preference) {
  const normalized = String(preference || 'medium').trim();
  if (normalized === 'low') {
    return '请用简洁、克制的篇幅回复：优先直达要点，避免不必要的铺陈，但必须保留情节推进、人物情绪、关键信息与必要细节。';
  }
  if (normalized === 'high') {
    return '请以充分、细腻且高投入的方式回复：在不偏离角色与上下文的前提下，尽力扩展场景、心理、动作、对话层次与情节推进，让回复完整、饱满、有沉浸感。';
  }
  return '';
}

function composeSystemPrompt({ promptBlocks = [], characterPromptItems = [], systemHint = '', runtimeContext = {} }) {
  const replyLengthInstruction = buildReplyLengthInstruction(runtimeContext.replyLengthPreference || runtimeContext.reply_length_preference);
  const sections = [
    ...normalizePromptItems(promptBlocks)
      .filter((item) => item.isEnabled && String(item.value || '').trim())
      .map((item) => formatPromptSection(
        applyRuntimeTemplate(item.key, runtimeContext),
        applyRuntimeTemplate(item.value, runtimeContext),
      )),
    ...normalizePromptItems(characterPromptItems)
      .filter((item) => item.isEnabled && String(item.value || '').trim())
      .map((item) => formatPromptSection(
        applyRuntimeTemplate(item.key, runtimeContext),
        applyRuntimeTemplate(item.value, runtimeContext),
      )),
    formatPromptSection('运行时要求', applyRuntimeTemplate([systemHint, replyLengthInstruction].filter(Boolean).join('\n'), runtimeContext)),
  ].filter(Boolean);

  return sections.join('\n\n');
}

async function listPromptBlocks(options = {}) {
  const whereClause = options.enabledOnly ? 'WHERE is_enabled = 1' : '';
  return query(
    `SELECT id, block_key, block_value, sort_order, is_enabled, created_at, updated_at
     FROM system_prompt_blocks
     ${whereClause}
     ORDER BY sort_order ASC, id ASC`,
  );
}

async function createPromptBlock(payload) {
  const rows = await query('SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM system_prompt_blocks');
  const nextSortOrder = Number(rows[0]?.max_sort ?? -1) + 1;

  const result = await query(
    `INSERT INTO system_prompt_blocks (
      block_key, block_value, sort_order, is_enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NOW(), NOW())`,
    [
      String(payload.key || '').trim(),
      String(payload.value || '').trim(),
      payload.sortOrder === undefined ? nextSortOrder : Number(payload.sortOrder || 0),
      payload.isEnabled ? 1 : 0,
    ],
  );

  return result.insertId;
}

async function updatePromptBlock(blockId, payload) {
  await query(
    `UPDATE system_prompt_blocks
     SET block_key = ?,
         block_value = ?,
         sort_order = ?,
         is_enabled = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      String(payload.key || '').trim(),
      String(payload.value || '').trim(),
      Number(payload.sortOrder || 0),
      payload.isEnabled ? 1 : 0,
      blockId,
    ],
  );
}

async function reorderPromptBlocks(blockIds = []) {
  const normalizedIds = Array.from(new Set((blockIds || []).map((id) => Number(id)).filter((id) => id > 0)));
  for (let index = 0; index < normalizedIds.length; index += 1) {
    await query(
      `UPDATE system_prompt_blocks
       SET sort_order = ?, updated_at = NOW()
       WHERE id = ?`,
      [index, normalizedIds[index]],
    );
  }
}

async function deletePromptBlock(blockId) {
  await query('DELETE FROM system_prompt_blocks WHERE id = ?', [blockId]);
}

function buildPromptPreview({ promptBlocks = [], character = {}, systemHint = '', runtimeContext = {} }) {
  return composeSystemPrompt({
    promptBlocks,
    characterPromptItems: buildCharacterPromptItems(character),
    systemHint,
    runtimeContext,
  });
}

module.exports = {
  normalizePromptItems,
  parsePromptItemsFromForm,
  formatPromptSection,
  buildCharacterPromptItems,
  formatRuntimeTime,
  applyRuntimeTemplate,
  applyRuntimeTemplateToCharacter,
  buildReplyLengthInstruction,
  composeSystemPrompt,
  buildPromptPreview,
  listPromptBlocks,
  createPromptBlock,
  updatePromptBlock,
  reorderPromptBlocks,
  deletePromptBlock,
};
