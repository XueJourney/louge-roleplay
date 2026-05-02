/**
 * @file public/js/notification-client.js
 * @description 前台站内通知与客服入口展示。调用说明：layout 注入 bootstrap 后自动显示，聊天错误可触发 support 模式。
 */

(function () {
  const bootstrap = window.AI_ROLEPLAY_NOTIFICATIONS || { items: [] };
  const t = window.AI_ROLEPLAY_I18N && typeof window.AI_ROLEPLAY_I18N.t === 'function'
    ? window.AI_ROLEPLAY_I18N.t.bind(window.AI_ROLEPLAY_I18N)
    : (key) => key;
  const notifications = Array.isArray(bootstrap.items) ? bootstrap.items : [];
  const storagePrefix = 'louge.notification.seen.';
  let activeOverlay = null;

  function text(value) {
    return String(value || '').trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeMarkdownLines(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/^(\s*)&gt;\s?/gm, '$1> ')
      .replace(/^(\s*)([-*_])\2\2\s*$/gm, '$1---');
  }

  function isSafeHttpUrl(value) {
    try {
      const parsed = new URL(String(value || '').trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function applyInlineMarkdown(value) {
    return String(value || '')
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (full, alt, url) => (
        isSafeHttpUrl(url) ? `<img alt="${escapeHtml(alt)}" src="${escapeHtml(url)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : full
      ))
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (full, label, url) => (
        isSafeHttpUrl(url) ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>` : full
      ))
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)(?!\s)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_(?!\s)(.+?)(?!\s)_/g, '$1<em>$2</em>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function markdownToHtml(value) {
    const normalized = normalizeMarkdownLines(value);
    const escaped = escapeHtml(normalized);
    const fenced = [];
    let htmlSeed = escaped.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const key = `__CODE_BLOCK_${fenced.length}__`;
      fenced.push(`<pre><code class="lang-${escapeHtml(lang || 'plain')}">${code}</code></pre>`);
      return key;
    });
    const lines = htmlSeed.split('\n');
    const parts = [];
    let paragraphLines = [];
    const flushParagraph = () => {
      if (!paragraphLines.length) return;
      parts.push(`<p>${applyInlineMarkdown(paragraphLines.join('<br>'))}</p>`);
      paragraphLines = [];
    };
    const isBlank = (line) => !String(line || '').trim();
    const isFencePlaceholder = (line) => /^__CODE_BLOCK_\d+__$/.test(String(line || '').trim());
    const isHr = (line) => /^(?:---|\*\*\*|___)\s*$/.test(String(line || '').trim());
    const parseHeading = (line) => String(line || '').match(/^(#{1,6})\s+(.+)$/);
    const isBullet = (line) => /^[-*]\s+.+$/.test(String(line || '').trim());
    const isOrdered = (line) => /^\d+\.\s+.+$/.test(String(line || '').trim());
    const isQuoted = (line) => /^(?:>|&gt;)\s?.*$/.test(String(line || '').trim());
    const isQuoteMarkerOnly = (line) => /^(?:>|&gt;)\s*$/.test(String(line || '').trim());

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = String(line || '').trim();
      if (isBlank(line)) { flushParagraph(); continue; }
      if (isFencePlaceholder(trimmed)) { flushParagraph(); parts.push(trimmed); continue; }
      if (isHr(line)) { flushParagraph(); parts.push('<hr>'); continue; }
      const headingMatch = parseHeading(line);
      if (headingMatch) {
        flushParagraph();
        const level = headingMatch[1].length;
        parts.push(`<h${level}>${applyInlineMarkdown(headingMatch[2].trim())}</h${level}>`);
        continue;
      }
      if (isQuoted(line)) {
        flushParagraph();
        const quoteLines = [];
        if (isQuoteMarkerOnly(line)) {
          i += 1;
          while (i < lines.length && !isBlank(lines[i])) { quoteLines.push(lines[i]); i += 1; }
          i -= 1;
        } else {
          while (i < lines.length && isQuoted(lines[i]) && !isQuoteMarkerOnly(lines[i])) {
            quoteLines.push(String(lines[i] || '').replace(/^(?:>|&gt;)\s?/, ''));
            i += 1;
          }
          i -= 1;
        }
        parts.push(`<blockquote>${applyInlineMarkdown(quoteLines.join('<br>').trim())}</blockquote>`);
        continue;
      }
      if (isBullet(line)) {
        flushParagraph();
        const items = [];
        while (i < lines.length && isBullet(lines[i])) {
          items.push(String(lines[i] || '').trim().replace(/^[-*]\s+/, ''));
          i += 1;
        }
        i -= 1;
        parts.push(`<ul>${items.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join('')}</ul>`);
        continue;
      }
      if (isOrdered(line)) {
        flushParagraph();
        const items = [];
        while (i < lines.length && isOrdered(lines[i])) {
          items.push(String(lines[i] || '').trim().replace(/^\d+\.\s+/, ''));
          i += 1;
        }
        i -= 1;
        parts.push(`<ol>${items.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join('')}</ol>`);
        continue;
      }
      paragraphLines.push(trimmed);
    }
    flushParagraph();
    let html = parts.join('');
    fenced.forEach((snippet, index) => {
      html = html.replace(`__CODE_BLOCK_${index}__`, snippet);
    });
    return html;
  }

  function renderMarkdownInto(element, notification) {
    if (!element) return;
    element.classList.add('markdown-body');
    element.innerHTML = text(notification.bodyHtml) || markdownToHtml(text(notification.body));
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
    img.alt = t('微信扫码联系客服');
    img.loading = 'lazy';
    img.src = qrImageUrl(value);

    const hint = document.createElement('div');
    hint.className = 'site-notification-qr__hint';
    hint.textContent = t('微信扫码联系客服');

    wrap.appendChild(img);
    wrap.appendChild(hint);
    return wrap;
  }

  function renderToast(notification) {
    const toast = document.createElement('div');
    toast.className = 'site-notification-toast';
    toast.innerHTML = '<strong></strong><span></span><a hidden></a><button type="button">×</button>';
    toast.querySelector('button').setAttribute('aria-label', t('关闭通知'));
    const action = toast.querySelector('a');
    if (text(notification.actionUrl)) {
      action.hidden = false;
      action.href = text(notification.actionUrl);
      action.textContent = text(notification.actionLabel) || t('打开链接');
    }
    toast.querySelector('strong').textContent = text(notification.title) || t('通知');
    renderMarkdownInto(toast.querySelector('span'), notification);
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
    copy.querySelector('strong').textContent = text(notification.title) || t('通知');
    renderMarkdownInto(copy.querySelector('span'), notification);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = t('知道了');
    close.addEventListener('click', () => {
      banner.remove();
      markSeen(notification);
    });
    banner.appendChild(copy);
    if (text(notification.actionUrl)) {
      const action = document.createElement('a');
      action.className = 'site-notification-action';
      action.href = text(notification.actionUrl);
      action.textContent = text(notification.actionLabel) || t('打开链接');
      banner.appendChild(action);
    }
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
    kicker.textContent = options && options.supportMode ? t('联系客服') : t('通知');

    const title = document.createElement('h2');
    title.textContent = text(notification.title) || t('通知');

    const body = document.createElement('div');
    body.className = 'site-notification-body';
    renderMarkdownInto(body, notification);

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
      action.textContent = text(notification.actionLabel) || t('打开链接');
      actions.appendChild(action);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = notification.forceDisplay ? t('暂时关闭') : t('知道了');
    close.addEventListener('click', () => closeActiveOverlay(notification));
    actions.appendChild(close);

    const scrollArea = document.createElement('div');
    scrollArea.className = 'site-notification-scroll';
    scrollArea.appendChild(body);
    if (qr) scrollArea.appendChild(qr);

    card.appendChild(kicker);
    card.appendChild(title);
    card.appendChild(scrollArea);
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
      title: t('需要客服协助？'),
      body: t('如果页面报错或当前状态不对，可以使用微信扫码联系客服。'),
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
