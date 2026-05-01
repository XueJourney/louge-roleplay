/**
 * @file src/services/email-template-service.js
 * @description Branded HTML email templates for verification messages.
 */

'use strict';

const config = require('../config');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildVerificationEmailText(code) {
  return `你的楼阁验证码是 ${code}，5 分钟内有效。若不是你本人操作，请忽略此邮件。`;
}

function buildVerificationEmailHtml(code) {
  const safeCode = escapeHtml(code);
  const appName = escapeHtml(config.appName || '楼阁');
  const appUrl = escapeHtml(config.appUrl || '');
  const year = new Date().getFullYear();

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${appName} 验证码</title>
</head>
<body style="margin:0;background:#eef5f4;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',Arial,sans-serif;color:#17383b;">
  <div style="max-width:560px;margin:0 auto;background:#fbfdfc;border:1px solid #d9e8e5;border-radius:24px;overflow:hidden;box-shadow:0 22px 70px rgba(16,62,67,.16);">
    <div style="background:linear-gradient(135deg,#07383d,#0f5a60 58%,#d8b76a);padding:30px 32px;color:#fff;">
      <div style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;opacity:.78;">${appName}</div>
      <h1 style="margin:12px 0 0;font-size:26px;line-height:1.3;font-weight:700;">确认是你本人</h1>
      <p style="margin:10px 0 0;font-size:14px;line-height:1.8;opacity:.86;">把这串验证码填回页面，就可以继续完成注册或登录。</p>
    </div>
    <div style="padding:34px 32px 28px;">
      <p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#35575a;">你的验证码是：</p>
      <div style="margin:0 0 22px;padding:20px 22px;background:#f4faf8;border:1px solid #cfe3df;border-radius:18px;text-align:center;">
        <div style="font-size:38px;line-height:1;letter-spacing:.28em;font-weight:800;color:#0b4b51;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;">${safeCode}</div>
      </div>
      <p style="margin:0;font-size:14px;line-height:1.8;color:#5d7476;">验证码 <strong style="color:#17383b;">5 分钟内有效</strong>。如果这不是你本人操作，可以直接忽略这封邮件；我们不会在邮件里索要你的密码。</p>
      ${appUrl ? `<div style="margin-top:26px;"><a href="${appUrl}" style="display:inline-block;padding:11px 18px;border-radius:999px;background:#0b4b51;color:#fff;text-decoration:none;font-size:14px;font-weight:700;">回到 ${appName}</a></div>` : ''}
    </div>
    <div style="padding:18px 32px;background:#f5faf9;border-top:1px solid #e2eeeb;color:#7b9092;font-size:12px;line-height:1.7;">
      © ${year} ${appName}. 这是一封自动发送的安全邮件，请勿直接回复。
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  buildVerificationEmailText,
  buildVerificationEmailHtml,
};
