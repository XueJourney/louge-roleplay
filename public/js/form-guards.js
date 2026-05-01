/**
 * @file public/js/form-guards.js
 * @description CSP 兼容的全局表单保护：替代模板里的 inline onsubmit confirm。
 */

(function () {
  document.addEventListener('submit', (event) => {
    const form = event.target && event.target.closest ? event.target.closest('form[data-confirm-message]') : null;
    if (!form) return;
    const message = String(form.getAttribute('data-confirm-message') || '').trim();
    if (message && !window.confirm(message)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}());
