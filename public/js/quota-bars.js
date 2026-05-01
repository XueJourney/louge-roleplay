/**
 * @file public/js/quota-bars.js
 * @description 将 data-width 百分比应用到额度条，避免 inline style 违反 CSP。
 */

(function () {
  function applyQuotaBars() {
    document.querySelectorAll('.quota-bar [data-width]').forEach((bar) => {
      const raw = Number(bar.getAttribute('data-width') || 0);
      const width = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
      bar.style.width = `${width}%`;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyQuotaBars, { once: true });
  } else {
    applyQuotaBars();
  }
}());
