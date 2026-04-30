/**
 * @file public/js/notification-client.js
 * @description 前台站内通知与客服入口展示。调用说明：layout 注入 bootstrap 后自动显示，聊天错误可触发 support 模式。
 */

(function () {
  const bootstrap = window.AI_ROLEPLAY_NOTIFICATIONS || { items: [] };
  const notifications = Array.isArray(bootstrap.items) ? bootstrap.items : [];
  const storagePrefix = 'louge.notification.seen.';
  let activeOverlay = null;

  function text(value) {
    return String(value || '').trim();
  }

  function storageKey(notification) {
    return storagePrefix + String(notification.id || notification.title || 'unknown');
  }

  function hasSeen(notification) {
    if (!notification || notification.forceDisplay) return false;
    if (!notification.showOnce) return false;
    try {
      return window.localStorage.getItem(storageKey(notification)) === '1';
    } catch (_) {
      return false;
    }
  }

  function markSeen(notification) {
    if (!notification || !notification.showOnce) return;
    try {
      window.localStorage.setItem(storageKey(notification), '1');
    } catch (_) {
      // localStorage may be unavailable in private mode; ignore.
    }
  }

  function qrImageUrl(rawValue) {
    const value = text(rawValue);
    if (!value) return '';
    return 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=' + encodeURIComponent(value);
  }

  function closeActiveOverlay(notification) {
    if (!activeOverlay) return;
    activeOverlay.classList.remove('is-visible');
    const overlay = activeOverlay;
    activeOverlay = null;
    window.setTimeout(() => overlay.remove(), 180);
    markSeen(notification);
  }

  function buildSupportQr(notification) {
    const value = text(notification.supportQrUrl || notification.actionUrl);
    if (!value) return null;
    const wrap = document.createElement('div');
    wrap.className = 'site-notification-qr';

    const img = document.createElement('img');
    img.alt = '微信扫码联系客服';
    img.loading = 'lazy';
    img.src = qrImageUrl(value);

    const hint = document.createElement('div');
    hint.className = 'site-notification-qr__hint';
    hint.textContent = '微信扫码联系客服';

    wrap.appendChild(img);
    wrap.appendChild(hint);
    return wrap;
  }

  function renderToast(notification) {
    const toast = document.createElement('div');
    toast.className = 'site-notification-toast';
    toast.innerHTML = '<strong></strong><span></span><button type="button" aria-label="关闭通知">×</button>';
    toast.querySelector('strong').textContent = text(notification.title) || '通知';
    toast.querySelector('span').textContent = text(notification.body);
    toast.querySelector('button').addEventListener('click', () => {
      toast.remove();
      markSeen(notification);
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    const duration = Number(notification.displayDurationMs || 0);
    if (duration > 0) {
      window.setTimeout(() => {
        toast.classList.remove('is-visible');
        window.setTimeout(() => toast.remove(), 180);
        markSeen(notification);
      }, duration);
    }
  }

  function renderBanner(notification) {
    const banner = document.createElement('div');
    banner.className = 'site-notification-banner';
    const copy = document.createElement('div');
    copy.innerHTML = '<strong></strong><span></span>';
    copy.querySelector('strong').textContent = text(notification.title) || '通知';
    copy.querySelector('span').textContent = text(notification.body);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '知道了';
    close.addEventListener('click', () => {
      banner.remove();
      markSeen(notification);
    });
    banner.appendChild(copy);
    banner.appendChild(close);
    document.body.prepend(banner);
    const duration = Number(notification.displayDurationMs || 0);
    if (duration > 0) {
      window.setTimeout(() => {
        banner.remove();
        markSeen(notification);
      }, duration);
    }
  }

  function renderModal(notification, options) {
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
    const overlay = document.createElement('div');
    overlay.className = 'site-notification-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const card = document.createElement('div');
    card.className = 'site-notification-card';

    const kicker = document.createElement('div');
    kicker.className = 'site-notification-kicker';
    kicker.textContent = options && options.supportMode ? 'Customer Support' : 'Notice';

    const title = document.createElement('h2');
    title.textContent = text(notification.title) || '通知';

    const body = document.createElement('p');
    body.textContent = text(notification.body);

    const qr = buildSupportQr(notification);

    const actions = document.createElement('div');
    actions.className = 'site-notification-actions';

    const isSupportModal = Boolean(options && options.supportMode) || text(notification.notificationType) === 'support';

    if (!isSupportModal && text(notification.actionUrl)) {
      const action = document.createElement('a');
      action.className = 'site-notification-action';
      action.href = text(notification.actionUrl);
      action.target = '_blank';
      action.rel = 'noopener noreferrer';
      action.textContent = text(notification.actionLabel) || '打开链接';
      actions.appendChild(action);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = notification.forceDisplay ? '暂时关闭' : '知道了';
    close.addEventListener('click', () => closeActiveOverlay(notification));
    actions.appendChild(close);

    card.appendChild(kicker);
    card.appendChild(title);
    card.appendChild(body);
    if (qr) card.appendChild(qr);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    activeOverlay = overlay;
    requestAnimationFrame(() => overlay.classList.add('is-visible'));

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay && !notification.forceDisplay) {
        closeActiveOverlay(notification);
      }
    });

    const duration = Number(notification.displayDurationMs || 0);
    if (duration > 0 && !notification.forceDisplay) {
      window.setTimeout(() => closeActiveOverlay(notification), duration);
    }
  }

  function showNotification(notification, options) {
    if (!notification || hasSeen(notification)) return false;
    const position = text(notification.displayPosition) || 'modal';
    if (position === 'toast') {
      renderToast(notification);
      return true;
    }
    if (position === 'banner') {
      renderBanner(notification);
      return true;
    }
    renderModal(notification, options || {});
    return true;
  }

  function showInitialNotifications() {
    notifications
      .filter((item) => !hasSeen(item))
      .sort((a, b) => Number(b.forceDisplay || 0) - Number(a.forceDisplay || 0) || Number(b.priority || 0) - Number(a.priority || 0))
      .slice(0, 3)
      .forEach((notification, index) => {
        window.setTimeout(() => showNotification(notification), index * 450);
      });
  }

  async function showSupport(options) {
    const local = notifications.find((item) => text(item.notificationType) === 'support');
    if (local) {
      return showNotification({ ...local, showOnce: false, forceDisplay: false, displayPosition: 'modal' }, { supportMode: true, ...(options || {}) });
    }
    try {
      const response = await fetch('/api/support-notification', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('support notification unavailable');
      const payload = await response.json();
      const notification = payload && payload.notification;
      if (notification) {
        return showNotification({ ...notification, showOnce: false, forceDisplay: false, displayPosition: 'modal' }, { supportMode: true, ...(options || {}) });
      }
    } catch (_) {
      // fall through to built-in support fallback
    }
    return showNotification({
      id: 'support-fallback',
      title: '需要客服协助？',
      body: '如果页面报错或当前状态不对，可以使用微信扫码联系客服。',
      notificationType: 'support',
      displayPosition: 'modal',
      supportQrUrl: 'https://work.weixin.qq.com/u/vc4a43a573988025fe?v=5.0.7.68221&bb=66637a4084',
      showOnce: false,
      forceDisplay: false,
    }, { supportMode: true, ...(options || {}) });
  }

  window.LougeNotifications = {
    show: showNotification,
    showSupport,
    items: notifications,
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target && event.target.closest ? event.target.closest('[data-open-support]') : null;
    if (!trigger) return;
    event.preventDefault();
    showSupport({ reason: trigger.getAttribute('data-support-reason') || 'manual' });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showInitialNotifications, { once: true });
  } else {
    showInitialNotifications();
  }
})();
