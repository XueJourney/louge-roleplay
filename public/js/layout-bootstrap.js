/**
 * @file public/js/layout-bootstrap.js
 * @description 全站前端 bootstrap。由 layout 注入 JSON 数据，本文件负责挂到 window。
 */

(function () {
  const data = document.getElementById('app-bootstrap-data');
  let payload = {};
  if (data && data.textContent) {
    try {
      payload = JSON.parse(data.textContent);
    } catch (_) {
      payload = {};
    }
  }

  window.AI_ROLEPLAY_I18N = payload.i18n || { locale: 'zh-CN', messages: {} };
  window.AI_ROLEPLAY_NOTIFICATIONS = payload.notifications || { items: [] };
  window.AI_ROLEPLAY_CSRF_TOKEN = payload.csrfToken || '';
}());
