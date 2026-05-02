/**
 * @file public/js/admin-page.js
 * @description 管理后台页面脚本。
 * 实现：套餐计费模式切换 + 全局提示词片段拖拽排序/按钮排序 + 列表搜索过滤。
 * DEBUG：若交互失效，先检查 data-billing-mode / #prompt-blocks-list / #prompt-blocks-reorder-ids / [data-admin-filter] 是否存在。
 */

(function () {
  const t = window.AI_ROLEPLAY_I18N?.t || ((key) => key);
  document.querySelectorAll('[data-billing-mode]').forEach((select) => {
    const group = select.closest('form')?.querySelector('[data-plan-quota-group]');
    if (!group) return;
    const requestField = group.querySelector('[data-request-quota-field]');
    const tokenField = group.querySelector('[data-token-quota-field]');
    function apply() {
      const mode = select.value;
      if (requestField) requestField.style.display = mode === 'per_request' || mode === 'hybrid' ? '' : 'none';
      if (tokenField) tokenField.style.display = mode === 'per_token' || mode === 'hybrid' ? '' : 'none';
    }
    select.addEventListener('change', apply);
    apply();
  });
  function setupPlanModelRow(row) {
    if (!row || row.dataset.planModelInitialized === '1') return;
    row.dataset.planModelInitialized = '1';
    const providerSelect = row.querySelector('[data-plan-model-provider]');
    const modelSelect = row.querySelector('[data-plan-model-select]');
    const presetSelect = row.querySelector('[data-plan-model-preset]');

    function applyPresetPreview() {
      if (!presetSelect) return;
      const option = presetSelect.selectedOptions?.[0];
      const name = option?.dataset.modelLabel || option?.textContent || '未选择模型';
      const description = option?.dataset.modelDescription || '暂无描述';
      const previewName = row.querySelector('[data-plan-model-preview-name]');
      const previewDesc = row.querySelector('[data-plan-model-preview-desc]');
      const defaultInput = row.querySelector('[data-plan-model-default]');
      if (previewName) previewName.textContent = name;
      if (previewDesc) previewDesc.textContent = description;
      if (defaultInput) defaultInput.value = presetSelect.value || '';
    }

    presetSelect?.addEventListener('change', applyPresetPreview);
    applyPresetPreview();

    function applyModelFilter() {
      if (!providerSelect || !modelSelect) return;
      const providerId = String(providerSelect.value || '');
      let selectedVisible = false;
      Array.from(modelSelect.options).forEach((option) => {
        const optionProviderId = String(option.dataset.providerId || '');
        const visible = !option.value || optionProviderId === providerId;
        option.hidden = !visible;
        option.disabled = !visible;
        if (option.selected && visible) selectedVisible = true;
      });
      if (!selectedVisible) {
        modelSelect.value = '';
      }
    }

    providerSelect?.addEventListener('change', applyModelFilter);
    applyModelFilter();

    const keyInput = row.querySelector('[data-plan-model-key]');
    const defaultInput = row.querySelector('[data-plan-model-default]');
    const syncDefaultValue = () => {
      if (defaultInput && keyInput) defaultInput.value = keyInput.value || '';
    };
    keyInput?.addEventListener('input', syncDefaultValue);
    syncDefaultValue();

    row.querySelector('[data-plan-model-remove]')?.addEventListener('click', () => {
      const list = row.closest('[data-plan-model-list]');
      if (list && list.querySelectorAll('.plan-model-row').length <= 1) {
        row.querySelectorAll('input, select').forEach((field) => {
          if (field.type === 'radio') field.checked = true;
          else if (field.name === 'planModelRequestMultiplier' || field.name === 'planModelTokenMultiplier') field.value = '1';
          else if (field.tagName === 'SELECT') field.selectedIndex = field.querySelector('option[value]:not([value=""])') ? Array.from(field.options).findIndex((option) => option.value) : 0;
          else field.value = '';
        });
        syncDefaultValue();
        applyModelFilter();
        applyPresetPreview();
        return;
      }
      const wasDefault = Boolean(defaultInput?.checked);
      row.remove();
      if (wasDefault && list) {
        const firstDefault = list.querySelector('[data-plan-model-default]');
        if (firstDefault) firstDefault.checked = true;
      }
    });
  }

  document.querySelectorAll('.plan-model-row').forEach(setupPlanModelRow);
  document.querySelectorAll('[data-plan-model-add]').forEach((button) => {
    button.addEventListener('click', () => {
      const form = button.closest('form');
      const list = form?.querySelector('[data-plan-model-list]');
      const template = document.getElementById('plan-model-row-template');
      if (!list || !template) return;
      const index = list.querySelectorAll('.plan-model-row').length + 1;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = template.innerHTML.replace(/__INDEX__/g, String(index + 1)).trim();
      const row = wrapper.firstElementChild;
      if (!row) return;
      list.appendChild(row);
      setupPlanModelRow(row);
    });
  });

  document.querySelectorAll('[data-preset-provider]').forEach((providerSelect) => {
    const form = providerSelect.closest('form');
    const modelSelect = form?.querySelector('[data-preset-model-select]');
    if (!modelSelect) return;
    function applyPresetModelFilter() {
      const providerId = String(providerSelect.value || '');
      let selectedVisible = false;
      Array.from(modelSelect.options).forEach((option) => {
        const optionProviderId = String(option.dataset.providerId || '');
        const visible = !option.value || optionProviderId === providerId;
        option.hidden = !visible;
        option.disabled = !visible;
        if (option.selected && visible) selectedVisible = true;
      });
      if (!selectedVisible) modelSelect.value = '';
    }
    providerSelect.addEventListener('change', applyPresetModelFilter);
    applyPresetModelFilter();
  });
})();

(function () {
  const list = document.getElementById('prompt-blocks-list');
  if (!list) return;
  const hidden = document.getElementById('prompt-blocks-reorder-ids');
  const reorderForm = document.getElementById('prompt-blocks-reorder-form');
  const previewOutput = document.getElementById('prompt-preview-output');
  const t = window.AI_ROLEPLAY_I18N?.t || ((key) => key);
  let dragging = null;

  function getItems() {
    return Array.from(list.querySelectorAll('.prompt-block-item'));
  }

  function formatPromptSection(key, value) {
    const cleanKey = String(key || '').trim();
    const cleanValue = String(value || '').trim();
    if (!cleanValue) return '';
    if (!cleanKey) {
      return `【[${t('未命名片段')}]】{\n${cleanValue}\n}`;
    }
    return `【[${cleanKey}]】{\n${cleanValue}\n}`;
  }

  function renderPreview() {
    if (!previewOutput) return;
    const sections = getItems()
      .map((item) => {
        const key = item.querySelector('input[name="key"]')?.value || '';
        const value = item.querySelector('textarea[name="value"]')?.value || '';
        const isEnabled = (item.querySelector('select[name="isEnabled"]')?.value || '1') !== '0';
        if (!isEnabled) return '';
        return formatPromptSection(key, value);
      })
      .filter(Boolean);

    previewOutput.textContent = sections.join('\n\n') || t('当前没有可预览的启用片段。');
  }

  function syncOrder() {
    const items = getItems();
    const ids = items
      .map((item) => String(item.dataset.blockId || '').trim())
      .filter((value) => /^\d+$/.test(value));

    if (hidden) hidden.value = ids.join(',');

    items.forEach((item, index) => {
      const label = item.querySelector('[data-order]');
      if (label) label.textContent = index;
      const sortInput = item.querySelector('[data-sort-input]');
      if (sortInput) sortInput.value = index;
    });

    renderPreview();
  }

  function moveItem(item, direction) {
    if (!item) return;
    const sibling = direction === 'up' ? item.previousElementSibling : item.nextElementSibling;
    if (!sibling) return;
    if (direction === 'up') sibling.before(item);
    else sibling.after(item);
    syncOrder();
  }

  getItems().forEach((item) => {
    item.addEventListener('dragstart', () => {
      dragging = item;
      item.classList.add('dragging');
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      dragging = null;
      syncOrder();
    });

    item.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (!dragging || dragging === item) return;
      const rect = item.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      if (after) item.after(dragging);
      else item.before(dragging);
    });

    item.addEventListener('drop', (event) => {
      event.preventDefault();
      syncOrder();
    });
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-move]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const item = button.closest('.prompt-block-item');
    moveItem(item, button.dataset.move);
  });

  list.addEventListener('input', (event) => {
    const item = event.target.closest('.prompt-block-item');
    if (!item) return;

    if (event.target.matches('input[name="key"]')) {
      const title = item.querySelector('.admin-item-main strong');
      if (title) title.textContent = event.target.value.trim() || t('未命名片段');
    }

    renderPreview();
  });

  list.addEventListener('change', (event) => {
    const item = event.target.closest('.prompt-block-item');
    if (!item) return;

    if (event.target.matches('select[name="isEnabled"]')) {
      const pill = item.querySelector('.admin-item-main .pill');
      const enabled = event.target.value !== '0';
      if (pill) {
        pill.textContent = enabled ? t('启用') : t('停用');
        pill.classList.toggle('pill--success', enabled);
      }
    }

    renderPreview();
  });

  if (reorderForm) {
    reorderForm.addEventListener('submit', () => {
      syncOrder();
    });
  }

  syncOrder();
})();

(function () {
  const filters = document.querySelectorAll('[data-admin-filter]');
  if (!filters.length) return;

  function normalize(text) {
    return String(text || '').trim().toLowerCase();
  }

  filters.forEach((input) => {
    const targetId = input.dataset.filterTarget;
    const root = targetId ? document.getElementById(targetId) : null;
    if (!root) return;

    const items = Array.from(root.querySelectorAll('[data-filter-item]'));
    if (!items.length) return;

    function applyFilter() {
      const keyword = normalize(input.value);
      let visibleCount = 0;

      items.forEach((item) => {
        const haystack = normalize(item.dataset.filterText || item.textContent);
        const matched = !keyword || haystack.includes(keyword);
        item.hidden = !matched;
        if (matched) visibleCount += 1;
      });

      root.dataset.empty = visibleCount === 0 ? 'true' : 'false';
    }

    input.addEventListener('input', applyFilter);
    applyFilter();
  });
})();


(function () {
  document.querySelectorAll('.quota-bar--admin [data-width]').forEach((bar) => {
    const value = Math.max(0, Math.min(100, Number(bar.dataset.width || 0)));
    bar.style.setProperty('--quota-width', String(value));
  });
})();
