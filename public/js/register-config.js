/**
 * @file public/js/register-config.js
 * @description 注册页认证配置 bootstrap，避免 inline script 违反 CSP。
 */

(function () {
  const data = document.getElementById('register-auth-config-data');
  let payload = {};
  if (data && data.textContent) {
    try {
      payload = JSON.parse(data.textContent);
    } catch (_) {
      payload = {};
    }
  }
  window.AI_ROLEPLAY_AUTH_CONFIG = payload;
}());
