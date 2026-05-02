/**
 * @file public/js/tag-input.js
 * @description 可复用标签输入增强：逗号/回车生成标签 chip，保留原始 input 提交兼容。
 */
(function () {
  const t = window.AI_ROLEPLAY_I18N?.t || ((key, vars = {}) => String(key).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? `{${name}}`));
  const MAX_TAGS = 12;
  const MAX_TAG_LENGTH = 32;

  function normalizeTag(value) {
    return String(value || '')
      .normalize('NFC')
      .replace(/[#＃]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TAG_LENGTH);
  }

  function parseTags(value) {
    const seen = new Set();
    const tags = [];
    String(value || '').split(/[，,\n]/g).forEach((item) => {
      const tag = normalizeTag(item);
      if (!tag) return;
      const key = tag.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      tags.push(tag);
    });
    return tags.slice(0, MAX_TAGS);
  }

  function syncHiddenInput(input, tags) {
    input.value = tags.join(', ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function enhance(input) {
    if (!input || input.dataset.tagInputEnhanced === '1') return;
    input.dataset.tagInputEnhanced = '1';
    const tags = parseTags(input.value);
    const wrapper = document.createElement('div');
    wrapper.className = 'tag-input-shell';
    const chipList = document.createElement('div');
    chipList.className = 'tag-input-chip-list';
    const editor = document.createElement('input');
    editor.type = 'text';
    editor.className = 'tag-input-editor';
    editor.placeholder = input.getAttribute('data-tag-placeholder') || input.getAttribute('placeholder') || t('输入标签后按回车');
    editor.setAttribute('aria-label', t('新增标签'));
    const meta = document.createElement('div');
    meta.className = 'tag-input-meta';

    input.classList.add('tag-input-source');
    input.type = 'hidden';
    input.after(wrapper);
    wrapper.append(chipList, editor, meta);

    function render() {
      chipList.textContent = '';
      tags.forEach((tag, index) => {
        const chip = document.createElement('span');
        chip.className = 'tag-input-chip';
        const label = document.createElement('span');
        label.textContent = `#${tag}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', t('移除标签 {tag}', { tag }));
        remove.addEventListener('click', () => {
          tags.splice(index, 1);
          syncHiddenInput(input, tags);
          render();
          editor.focus();
        });
        chip.append(label, remove);
        chipList.appendChild(chip);
      });
      meta.textContent = t('已选择 {count}/{max} 个标签', { count: tags.length, max: MAX_TAGS });
      syncHiddenInput(input, tags);
    }

    function addTags(values = []) {
      const nextTags = Array.isArray(values) ? values : [values];
      nextTags.flatMap(parseTags).forEach((tag) => {
        if (tags.length >= MAX_TAGS) return;
        const key = tag.toLowerCase();
        if (tags.some((existing) => existing.toLowerCase() === key)) return;
        tags.push(tag);
      });
      render();
    }

    function addFromEditor() {
      const nextTags = parseTags(editor.value);
      if (!nextTags.length) return;
      addTags(nextTags);
      editor.value = '';
    }

    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
        event.preventDefault();
        addFromEditor();
      } else if (event.key === 'Backspace' && !editor.value && tags.length) {
        tags.pop();
        render();
      }
    });
    editor.addEventListener('blur', addFromEditor);
    editor.addEventListener('paste', () => setTimeout(addFromEditor, 0));
    wrapper.addEventListener('click', () => editor.focus());
    input.__lougeTagInput = {
      add: (value) => addTags(value),
      tags: () => tags.slice(),
      focus: () => editor.focus(),
    };
    render();
  }

  function boot(root = document) {
    root.querySelectorAll('[data-tag-input]').forEach(enhance);
  }

  document.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('[data-tag-suggestion]') : null;
    if (!button) return;
    const scope = button.closest('.field-group') || document;
    const input = scope.querySelector('[data-tag-input]');
    if (!input?.__lougeTagInput) return;
    event.preventDefault();
    input.__lougeTagInput.add(button.getAttribute('data-tag-suggestion') || button.textContent || '');
    input.__lougeTagInput.focus();
  });

  document.addEventListener('DOMContentLoaded', () => boot());
  window.LougeTagInput = { boot, parseTags, normalizeTag };
}());
