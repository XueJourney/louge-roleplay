/**
 * @file src/routes/web/admin/admin-route-utils.js
 * @description 管理后台路由共享小工具：表单校验错误识别和分页 URL 拼装。
 */

function isValidationError(error) {
  const message = String(error?.message || '');
  return message.includes('必须')
    || message.includes('不能小于')
    || message.includes('不能为空')
    || message.includes('超出允许范围');
}

function buildPageUrl(basePath, filters, targetPage, pageSize, options = {}) {
  const params = new URLSearchParams();
  const skipZero = Boolean(options.skipZero);
  Object.entries({ ...(filters || {}), page: targetPage, pageSize }).forEach(([key, value]) => {
    if (value === undefined || value === null || String(value).trim() === '') {
      return;
    }
    if (skipZero && Number(value) === 0) {
      return;
    }
    params.set(key, String(value));
  });
  return `${basePath}?${params.toString()}`;
}

module.exports = {
  isValidationError,
  buildPageUrl,
};
