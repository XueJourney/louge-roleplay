/**
 * @file public/js/csrf.js
 * @description 自动为同源 POST 表单与 fetch 请求附加 CSRF token。
 */

(function () {
  const meta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = window.AI_ROLEPLAY_CSRF_TOKEN || (meta ? meta.getAttribute('content') : '');
  if (!csrfToken) return;

  function attachCsrfToForms() {
    document.querySelectorAll('form[method]').forEach((form) => {
      const method = String(form.getAttribute('method') || '').toUpperCase();
      if (method !== 'POST') return;
      if (form.querySelector('input[name="_csrf"]')) return;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = '_csrf';
      input.value = csrfToken;
      form.appendChild(input);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachCsrfToForms, { once: true });
  } else {
    attachCsrfToForms();
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form || !form.matches || !form.matches('form[method]')) return;
    const method = String(form.getAttribute('method') || '').toUpperCase();
    if (method !== 'POST' || form.querySelector('input[name="_csrf"]')) return;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = '_csrf';
    input.value = csrfToken;
    form.appendChild(input);
  }, true);

  if (typeof window.fetch !== 'function') return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function csrfFetch(input, init) {
    const requestInit = Object.assign({}, init || {});
    const method = String(requestInit.method || (input && input.method) || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const parsed = new URL(url || window.location.href, window.location.href);
      if (parsed.origin === window.location.origin) {
        const headers = new Headers(requestInit.headers || (input && input.headers) || {});
        if (!headers.has('X-CSRF-Token')) {
          headers.set('X-CSRF-Token', csrfToken);
        }
        requestInit.headers = headers;
      }
    }
    return nativeFetch(input, requestInit);
  };
}());
