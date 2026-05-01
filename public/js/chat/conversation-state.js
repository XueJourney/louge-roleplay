/**
 * @file public/js/chat/conversation-state.js
 * @description 聊天页 URL leaf、父消息隐藏字段、可见消息计数与旧尾巴清理。
 */

(function () {
  function create(options) {
    const settings = Object.assign({ t: (key) => key }, options || {});
    const { form, textarea, chatContainer, t } = settings;

    function reloadToMessage(messageId, notice) {
      const normalizedMessageId = String(messageId || '').trim();
      if (!normalizedMessageId) return;
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('leaf', normalizedMessageId);
      if (notice) {
        nextUrl.searchParams.set('notice', notice);
      }
      window.setTimeout(() => {
        window.location.assign(nextUrl.toString());
      }, 450);
    }

    function updateHiddenParentInputs(messageId) {
      const normalizedMessageId = String(messageId || '').trim();
      if (!normalizedMessageId) return;
      document.querySelectorAll('input[name="parentMessageId"]').forEach((input) => {
        input.value = normalizedMessageId;
      });
    }

    function updateCurrentMessageState(messageId) {
      const normalizedMessageId = String(messageId || '').trim();
      if (!normalizedMessageId) return;
      updateHiddenParentInputs(normalizedMessageId);
      form.dataset.messageCount = String(Math.max(Number(form.dataset.messageCount || '0'), 1));
      if (chatContainer) {
        const currentCount = Number(chatContainer.dataset.visibleCount || '0') || chatContainer.querySelectorAll('article.bubble[data-message-id]').length;
        const totalCount = Number(chatContainer.dataset.totalCount || '0') || currentCount;
        chatContainer.dataset.visibleCount = String(Math.max(currentCount, chatContainer.querySelectorAll('article.bubble[data-message-id]').length));
        chatContainer.dataset.totalCount = String(Math.max(totalCount, chatContainer.querySelectorAll('article.bubble[data-message-id]').length));
        chatContainer.querySelectorAll('.empty-chat-state').forEach((node) => node.remove());
      }
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('leaf', normalizedMessageId);
      window.history.replaceState({}, '', nextUrl.toString());
    }

    function ensureStartMessage() {
      const currentMessageCount = Number(form.dataset.messageCount || '0');
      if (currentMessageCount === 0 && !textarea.value.trim()) {
        textarea.value = t('[开始一次新的对话]');
      }
    }

    function removeStaleLinearTail(messageId) {
      const normalizedMessageId = String(messageId || '').trim();
      if (!normalizedMessageId || !chatContainer) return;
      const articles = Array.from(chatContainer.querySelectorAll('article.bubble[data-message-id]'));
      const index = articles.findIndex((article) => String(article.dataset.messageId || '') === normalizedMessageId);
      if (index < 0) return;
      articles.slice(index + 1).forEach((article) => article.remove());
      chatContainer.dataset.visibleCount = String(chatContainer.querySelectorAll('article.bubble[data-message-id]').length);
      chatContainer.dataset.totalCount = String(Math.max(Number(chatContainer.dataset.totalCount || '0'), Number(chatContainer.dataset.visibleCount || '0')));
      updateHiddenParentInputs(normalizedMessageId);
    }

    function applyInitialUrlState() {
      const params = new URLSearchParams(window.location.search);
      const notice = params.get('notice');
      if (notice === 'updated' && typeof settings.showToast === 'function') {
        settings.showToast(t('已显示新的结果，旧内容已保留。'));
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete('notice');
        window.history.replaceState({}, '', nextUrl.toString());
      }
      const draft = params.get('draft');
      if (draft && !textarea.value.trim()) {
        textarea.value = draft;
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    }

    return {
      reloadToMessage,
      updateHiddenParentInputs,
      updateCurrentMessageState,
      ensureStartMessage,
      removeStaleLinearTail,
      applyInitialUrlState,
    };
  }

  window.LougeChatConversationState = { create };
})();
