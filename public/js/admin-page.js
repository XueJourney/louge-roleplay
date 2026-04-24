/**
 * @file public/js/admin-page.js
 * @description 管理后台页面脚本。
 * 实现：套餐计费模式切换 + 全局提示词片段拖拽排序。
 * DEBUG：若交互失效，先检查 data-billing-mode / #prompt-blocks-list / #prompt-blocks-reorder-ids 是否存在。
 */

  (function () {
    document.querySelectorAll('[data-billing-mode]').forEach((select) => {
      const group = select.closest('form')?.querySelector('[data-plan-quota-group]');
      if (!group) return;
      const requestField = group.querySelector('[data-request-quota-field]');
      const tokenField = group.querySelector('[data-token-quota-field]');
      function apply() {
        const mode = select.value;
        if (requestField) requestField.style.display = mode === 'per_request' ? '' : 'none';
        if (tokenField) tokenField.style.display = mode === 'per_token' ? '' : 'none';
      }
      select.addEventListener('change', apply);
      apply();
    });
  })();

  (function () {
    const list = document.getElementById('prompt-blocks-list');
    if (!list) return;
    const hidden = document.getElementById('prompt-blocks-reorder-ids');
    let dragging = null;

    function syncOrder() {
      const ids = Array.from(list.querySelectorAll('.prompt-block-item')).map((item) => item.dataset.blockId);
      if (hidden) hidden.value = ids.join(',');
      Array.from(list.querySelectorAll('.prompt-block-item')).forEach((item, index) => {
        const label = item.querySelector('[data-order]');
        if (label) label.textContent = index;
      });
    }

    Array.from(list.querySelectorAll('.prompt-block-item')).forEach((item) => {
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
    });

    syncOrder();
  })();
