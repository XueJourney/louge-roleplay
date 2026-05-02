/**
 * @file public/js/character-editor-page.js
 * @description 角色编辑页脚本。
 * 实现：额外提示词片段增删拖拽、结构化字段拼接预览。
 * DEBUG：若预览不刷新，先检查 #prompt-items / #character-prompt-preview 是否存在。
 */

  (function () {
    const t = window.AI_ROLEPLAY_I18N?.t || ((key) => key);
    const container = document.getElementById('prompt-items');
    const addButton = document.getElementById('add-prompt-item');
    const previewButton = document.getElementById('preview-character-prompt');
    const previewBox = document.getElementById('character-prompt-preview');
    let dragging = null;

    const structuredFields = [
      ['角色名', 'name'],
      ['角色简介', 'summary'],
      ['角色', 'role'],
      ['描述角色性格', 'traitDescription'],
      ['当前场景', 'currentScene'],
      ['当前背景', 'currentBackground'],
    ];

    function refreshOrders() {
      Array.from(container.querySelectorAll('.prompt-item')).forEach((item, index) => {
        const orderNode = item.querySelector('[data-order]');
        if (orderNode) orderNode.textContent = index + 1;
      });
    }

    function renderPreview() {
      const sections = structuredFields.map(([label, fieldId]) => {
        const field = document.getElementById(fieldId);
        const value = field?.value?.trim() || '';
        if (!value) return '';
        return `【[${label}]】{\n${value}\n}`;
      }).filter(Boolean);

      const extraItems = Array.from(container.querySelectorAll('.prompt-item')).map((item) => {
        const key = item.querySelector('input[name="extraPromptItemKey"]')?.value?.trim() || '';
        const value = item.querySelector('textarea[name="extraPromptItemValue"]')?.value?.trim() || '';
        const enabled = item.querySelector('select[name="extraPromptItemEnabled"]')?.value !== '0';
        if (!enabled || !value) return '';
        return `【[${key || t('未命名片段')}]】{\n${value}\n}`;
      }).filter(Boolean);

      previewBox.textContent = [...sections, ...extraItems].join('\n\n') || t('当前没有可拼接的角色提示词。');
    }

    function bindItem(item) {
      item.addEventListener('dragstart', () => {
        dragging = item;
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        dragging = null;
        refreshOrders();
        renderPreview();
      });
      item.addEventListener('dragover', (event) => {
        event.preventDefault();
        if (!dragging || dragging === item) return;
        const rect = item.getBoundingClientRect();
        const shouldInsertAfter = event.clientY > rect.top + rect.height / 2;
        if (shouldInsertAfter) item.after(dragging);
        else item.before(dragging);
      });
      const removeButton = item.querySelector('[data-action="remove"]');
      Array.from(item.querySelectorAll('input, textarea, select')).forEach((field) => {
        field.addEventListener('input', renderPreview);
        field.addEventListener('change', renderPreview);
      });
      if (removeButton) {
        removeButton.addEventListener('click', () => {
          item.remove();
          refreshOrders();
          renderPreview();
        });
      }
    }

    function createItem() {
      const wrapper = document.createElement('div');
      wrapper.className = 'prompt-item';
      wrapper.draggable = true;
      wrapper.innerHTML = `
        <div class="prompt-grid">
          <label>
            key
            <input type="text" name="extraPromptItemKey" maxlength="5000" placeholder="${t('比如：禁忌 / 世界规则 / 特殊要求')}" />
          </label>
          <label>
            value
            <textarea name="extraPromptItemValue" rows="4" maxlength="5000" placeholder="${t('写这个补充片段的内容')}"></textarea>
          </label>
          <label>
            ${t('启用')}
            <select name="extraPromptItemEnabled">
              <option value="1" selected>${t('启用')}</option>
              <option value="0">${t('停用')}</option>
            </select>
          </label>
        </div>
        <div class="prompt-actions">
          <button type="button" class="ghost-btn" data-action="remove">${t('删除这项')}</button>
          <span class="mini-note">${t('当前顺序：')}<span data-order></span></span>
        </div>
      `;
      bindItem(wrapper);
      return wrapper;
    }

    Array.from(container.querySelectorAll('.prompt-item')).forEach(bindItem);
    refreshOrders();

    structuredFields.forEach(([, fieldId]) => {
      const field = document.getElementById(fieldId);
      if (!field) return;
      field.addEventListener('input', renderPreview);
      field.addEventListener('change', renderPreview);
    });

    addButton.addEventListener('click', () => {
      container.appendChild(createItem());
      refreshOrders();
      renderPreview();
    });

    previewButton.addEventListener('click', renderPreview);

    renderPreview();
  })();
