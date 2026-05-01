/*
 * @file public/js/chat/dom-utils.js
 * @description 聊天页 DOM 小工具：滚动判断、菜单收起、toast、富文本挂载等。
 */

(function () {
  function isNearPageBottom(threshold) {
    const margin = Number(threshold || 180);
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const viewportBottom = scrollTop + window.innerHeight;
    const pageHeight = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    return pageHeight - viewportBottom <= margin;
  }

  function closeMessageMenus(scope) {
    const root = scope || document;
    root.querySelectorAll('.message-menu-details[open], .more-menu[open]').forEach((menu) => {
      menu.removeAttribute('open');
    });
    if (!scope && window.LougeMessageMenus && typeof window.LougeMessageMenus.closeAll === 'function') {
      window.LougeMessageMenus.closeAll();
    }
  }

  function closeSiblingMessageMenus(currentMenu) {
    document.querySelectorAll('.more-menu[open]').forEach((menu) => {
      if (menu !== currentMenu && !menu.contains(currentMenu)) {
        menu.removeAttribute('open');
      }
    });
  }

  function showToast(message) {
    const text = String(message || '').trim();
    if (!text) return;
    const toast = document.createElement('div');
    toast.className = 'chat-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    window.setTimeout(() => {
      toast.classList.remove('show');
      window.setTimeout(() => toast.remove(), 260);
    }, 2600);
  }

  function renderStreamingPlainText(container, text) {
    if (!container) return;
    const block = document.createElement('div');
    block.className = 'bubble-text';
    block.textContent = String(text || '');
    container.replaceChildren(block);
    container.dataset.lineMode = 'false';
    container.dataset.finalPass = 'false';
  }

  function createFragmentFromHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '').trim();
    return template.content;
  }

  function hydrateRichContent(root) {
    if (typeof window.renderRichContent !== 'function') {
      return;
    }
    (root || document).querySelectorAll('[data-message-content]').forEach((node) => window.renderRichContent(node));
  }

  window.LougeChatDomUtils = {
    isNearPageBottom,
    closeMessageMenus,
    closeSiblingMessageMenus,
    showToast,
    renderStreamingPlainText,
    createFragmentFromHtml,
    hydrateRichContent,
  };
}());
