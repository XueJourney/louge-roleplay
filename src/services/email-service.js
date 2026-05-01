/**
 * @file src/services/email-service.js
 * @description 邮箱验证码发送服务，基于 Resend API 发送注册/登录验证码邮件。
 */

const axios = require('axios');
const config = require('../config');
const { buildVerificationEmailText, buildVerificationEmailHtml } = require('./email-template-service');

async function sendVerificationEmail(email, code) {
  if (!config.resendApiKey) {
    throw new Error('RESEND_API_KEY is required');
  }

  await axios.post('https://api.resend.com/emails', {
    from: config.resendFrom,
    to: [email],
    subject: '楼阁验证码',
    text: buildVerificationEmailText(code),
    html: buildVerificationEmailHtml(code),
  }, {
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

module.exports = {
  sendVerificationEmail,
};
