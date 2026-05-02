/**
 * @file src/server-helpers/character-prompt-profile.js
 * @description 角色 Prompt Profile 表单与存储格式转换，供角色编辑页和路由层复用。
 */

const { parsePromptItemsFromForm, normalizePromptItems } = require('../services/prompt-engineering-service');
const { clampCharacterField } = require('../constants/character-limits');

function splitCharacterPromptProfile(promptProfileJson) {
  let items = [];

  if (Array.isArray(promptProfileJson)) {
    items = promptProfileJson;
  } else if (promptProfileJson && typeof promptProfileJson === 'object') {
    items = [promptProfileJson];
  } else {
    try {
      items = JSON.parse(promptProfileJson || '[]');
    } catch (error) {
      items = [];
    }
  }

  const structured = {
    role: '',
    traitDescription: '',
    currentScene: '',
    currentBackground: '',
  };
  const extraItems = [];

  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = String(item?.key || '').trim();
    const value = String(item?.value || '').trim();
    const isEnabled = item?.isEnabled === undefined ? true : Boolean(Number(item?.isEnabled ?? item?.is_enabled ?? 1));
    const normalized = { key, value, isEnabled, sortOrder: Number(item?.sortOrder ?? item?.sort_order ?? extraItems.length) };

    if (key === '角色') {
      structured.role = value;
      return;
    }
    if (key === '描述角色性格') {
      structured.traitDescription = value;
      return;
    }
    if (key === '当前场景') {
      structured.currentScene = value;
      return;
    }
    if (key === '当前背景') {
      structured.currentBackground = value;
      return;
    }

    if (key && key !== '角色名' && key !== '角色简介') {
      extraItems.push(normalized);
    }
  });

  return {
    structured,
    extraItems: normalizePromptItems(extraItems),
  };
}

function buildCharacterPromptProfileFromForm(body) {
  const extraItems = parsePromptItemsFromForm(body, {
    keyField: 'extraPromptItemKey',
    valueField: 'extraPromptItemValue',
    enabledField: 'extraPromptItemEnabled',
  });

  const structuredItems = [
    { key: '角色名', value: clampCharacterField(body.name), sortOrder: 0, isEnabled: true },
    { key: '角色简介', value: clampCharacterField(body.summary), sortOrder: 1, isEnabled: true },
    { key: '角色', value: clampCharacterField(body.role), sortOrder: 2, isEnabled: true },
    { key: '描述角色性格', value: clampCharacterField(body.traitDescription), sortOrder: 3, isEnabled: true },
    { key: '当前场景', value: clampCharacterField(body.currentScene), sortOrder: 4, isEnabled: true },
    { key: '当前背景', value: clampCharacterField(body.currentBackground), sortOrder: 5, isEnabled: true },
  ].filter((item) => item.value);

  const clampedExtraItems = extraItems.map((item) => ({
    ...item,
    key: clampCharacterField(item.key),
    value: clampCharacterField(item.value),
  }));

  return normalizePromptItems([
    ...structuredItems,
    ...clampedExtraItems.map((item, index) => ({ ...item, sortOrder: structuredItems.length + index })),
  ]);
}

module.exports = {
  splitCharacterPromptProfile,
  buildCharacterPromptProfileFromForm,
};
