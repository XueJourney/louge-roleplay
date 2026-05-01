/**
 * @file public/js/chat/message-menu.js
 * @description 聊天消息操作区：点击消息上的“⋯”，在对应消息上方插入轻量上下文操作卡。
 */

(function () {
  let activeMessageId = '';

  function getExistingDock() {
    return document.querySelector('[data-message-actions-dock]');
  }

  function setActiveMessage(article) {
    document.querySelectorAll('.bubble.is-actions-active').forEach((node) => {
      if (node !== article) node.classList.remove('is-actions-active');
    });
    if (article) article.classList.add('is-actions-active');
  }

  function closeActions() {
    const dock = getExistingDock();
    if (dock) dock.remove();
    activeMessageId = '';
    setActiveMessage(null);
  }

  function renderActionsFor(article) {
    const template = article && article.querySelector(':scope > template[data-message-actions-template]');
    if (!article || !template) return;

    const messageId = String(article.dataset.messageId || '').trim();
    if (activeMessageId && activeMessageId === messageId) {
      closeActions();
      return;
    }

    closeActions();

    const dock = document.createElement('div');
    dock.className = 'message-actions-dock';
    dock.dataset.messageActionsDock = 'true';
    dock.dataset.activeMessageId = messageId;

    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector('[data-message-actions-card]');
    if (!card) return;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'message-actions-close';
    closeButton.setAttribute('aria-label', (window.AI_ROLEPLAY_I18N && window.AI_ROLEPLAY_I18N.t ? window.AI_ROLEPLAY_I18N.t('关闭操作面板') : '关闭操作面板'));
    const closeIcon = document.createElement('span');
    closeIcon.setAttribute('aria-hidden', 'true');
    closeButton.appendChild(closeIcon);
    closeButton.addEventListener('click', closeActions);
    card.querySelector('.message-actions-head')?.appendChild(closeButton);

    dock.appendChild(card);
    const rich = article.querySelector(':scope > .bubble-rich');
    if (rich) {
      article.insertBefore(dock, rich);
    } else {
      article.appendChild(dock);
    }
    activeMessageId = messageId;
    setActiveMessage(article);

    requestAnimationFrame(() => {
      const rect = dock.getBoundingClientRect();
      const viewportTop = 12;
      if (rect.top < viewportTop || rect.bottom > window.innerHeight - 120) {
        const top = rect.top + window.scrollY - 16;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    });
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target && event.target.closest ? event.target.closest('[data-message-actions-trigger]') : null;
    if (!trigger) return;
    event.preventDefault();
    const article = trigger.closest('.bubble[data-message-id]');
    renderActionsFor(article);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeActions();
  });

  document.addEventListener('submit', (event) => {
    const dock = getExistingDock();
    if (dock && event.target && dock.contains(event.target)) {
      window.setTimeout(closeActions, 80);
    }
  }, true);

  window.LougeMessageMenus = {
    closeAll: closeActions,
    closeActions,
  };
}());
