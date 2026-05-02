/**
 * @file public/js/site-message-client.js
 * @description 站内信未读状态实时轮询与轻量提醒。
 */

(function () {
  const t = window.AI_ROLEPLAY_I18N && typeof window.AI_ROLEPLAY_I18N.t === 'function'
    ? window.AI_ROLEPLAY_I18N.t.bind(window.AI_ROLEPLAY_I18N)
    : (key, vars) => String(key || '').replace(/\{(\w+)\}/g, (_, name) => vars?.[name] ?? '');
  const bootstrap = window.AI_ROLEPLAY_SITE_MESSAGES || { unreadCount: 0 };
  const currentUser = window.AI_ROLEPLAY_CURRENT_USER || null;
  if (!currentUser) return;

  let unreadCount = Number(bootstrap.unreadCount || 0);
  let lastShownMessageId = 0;

  function ensureBadge() {
    let badge = document.querySelector('[data-site-message-badge]');
    if (badge) return badge;
    const link = document.querySelector('a[href="/messages"]');
    if (!link) return null;
    badge = document.createElement('span');
    badge.className = 'site-message-badge';
    badge.setAttribute('data-site-message-badge', '');
    link.appendChild(badge);
    return badge;
  }

  function updateBadge(count) {
    unreadCount = Number(count || 0);
    const badge = ensureBadge();
    if (!badge) return;
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.hidden = unreadCount <= 0;
  }

  function showInboxToast(message) {
    if (!message || Number(message.id || 0) <= lastShownMessageId) return;
    lastShownMessageId = Number(message.id || 0);
    if (window.location.pathname === '/messages') return;
    if (window.LougeNotifications && typeof window.LougeNotifications.show === 'function') {
      window.LougeNotifications.show({
        id: 'site-message-' + message.id,
        title: t('新的站内信'),
        body: String(message.title || '').trim() || t('你收到了一封新的站内信。'),
        notificationType: 'general',
        displayPosition: 'toast',
        displayDurationMs: 6000,
        showOnce: true,
        forceDisplay: false,
        actionLabel: t('查看站内信'),
        actionUrl: '/messages',
      });
    }
  }

  async function refreshStatus() {
    try {
      const response = await fetch('/api/site-messages/status', { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const payload = await response.json();
      const nextCount = Number(payload.unreadCount || 0);
      if (nextCount > unreadCount && Array.isArray(payload.latest) && payload.latest.length) {
        showInboxToast(payload.latest[0]);
      }
      updateBadge(nextCount);
    } catch (_) {
      // Ignore transient network errors; next poll will retry.
    }
  }

  updateBadge(unreadCount);
  window.setInterval(refreshStatus, 15000);
  window.addEventListener('focus', refreshStatus);
}());
