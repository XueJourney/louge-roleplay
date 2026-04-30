/**
 * @file src/config.js
 * @description 统一读取并导出应用配置，负责环境变量解析、默认值处理与敏感配置隔离。
 */

const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const packageInfo = require('../package.json');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function readString(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value).trim();
}

function readBool(name, fallback = false) {
  const value = readString(name, '');
  if (!value) {
    return fallback;
  }
  return value === 'true';
}

function maskSecret(value, options = {}) {
  const raw = String(value || '');
  const {
    keepStart = 3,
    keepEnd = 2,
    empty = '',
  } = options;

  if (!raw) {
    return empty;
  }
  if (raw.length <= keepStart + keepEnd) {
    return '*'.repeat(Math.max(raw.length, 6));
  }
  return `${raw.slice(0, keepStart)}***${raw.slice(-keepEnd)}`;
}

const sessionSecretFromEnv = readString('SESSION_SECRET', '');
const sessionSecretIsEphemeral = !sessionSecretFromEnv;
const sessionSecret = sessionSecretFromEnv || crypto.randomBytes(32).toString('hex');
const exposeAliyunPhoneAuthAppKey = readBool('ALIYUN_PHONE_AUTH_EXPOSE_APP_KEY', false);

const config = {
  port: Number(process.env.PORT || 3217),
  appName: readString('APP_NAME', '楼阁'),
  appVersion: readString('APP_VERSION', packageInfo.version || '0.0.0'),
  appUrl: readString('APP_URL', 'http://127.0.0.1:3217'),
  sessionSecret,
  sessionSecretIsEphemeral,
  databaseUrl: readString('DATABASE_URL', ''),
  databaseAdminUrl: readString('DATABASE_ADMIN_URL', ''),
  redisUrl: readString('REDIS_URL', ''),
  openaiBaseUrl: readString('OPENAI_BASE_URL', ''),
  openaiApiKey: readString('OPENAI_API_KEY', ''),
  openaiModel: readString('OPENAI_MODEL', ''),
  resendApiKey: readString('RESEND_API_KEY', ''),
  resendFrom: readString('RESEND_FROM', '楼阁 <aicafe@xuejourney.xin>'),
  aliyunPhoneAuthEnabled: readBool('ALIYUN_PHONE_AUTH_ENABLED', false),
  aliyunPhoneAuthAppId: readString('ALIYUN_PHONE_AUTH_APP_ID', ''),
  aliyunPhoneAuthAppKey: readString('ALIYUN_PHONE_AUTH_APP_KEY', ''),
  aliyunNumberAuthSchemeCode: readString('ALIYUN_NUMBER_AUTH_SCHEME_CODE', ''),
  aliyunAccessKeyId: readString('ALIYUN_ACCESS_KEY_ID', ''),
  aliyunAccessKeySecret: readString('ALIYUN_ACCESS_KEY_SECRET', ''),
  aliyunSmsSignName: readString('ALIYUN_SMS_SIGN_NAME', ''),
  aliyunSmsTemplateCode: readString('ALIYUN_SMS_TEMPLATE_CODE', ''),
  trustProxy: readBool('TRUST_PROXY', false),
  cookieSecure: readBool('COOKIE_SECURE', false),
  publicPhoneAuthConfig: {
    graphAuthAppId: readString('ALIYUN_PHONE_AUTH_APP_ID', ''),
    graphAuthAppKey: exposeAliyunPhoneAuthAppKey ? readString('ALIYUN_PHONE_AUTH_APP_KEY', '') : '',
    numberAuthSchemeCode: readString('ALIYUN_NUMBER_AUTH_SCHEME_CODE', ''),
  },
  getPrivacySafeSummary() {
    return {
      port: this.port,
      appName: this.appName,
      appVersion: this.appVersion,
      appUrl: this.appUrl,
      trustProxy: this.trustProxy,
      cookieSecure: this.cookieSecure,
      sessionSecretConfigured: !this.sessionSecretIsEphemeral,
      databaseConfigured: Boolean(this.databaseUrl),
      redisConfigured: Boolean(this.redisUrl),
      openaiConfigured: Boolean(this.openaiBaseUrl && this.openaiApiKey && this.openaiModel),
      resendConfigured: Boolean(this.resendApiKey),
      aliyunPhoneAuthEnabled: this.aliyunPhoneAuthEnabled,
      aliyunPhoneAuthPublic: {
        graphAuthAppIdConfigured: Boolean(this.publicPhoneAuthConfig.graphAuthAppId),
        graphAuthAppKeyExposed: Boolean(this.publicPhoneAuthConfig.graphAuthAppKey),
        numberAuthSchemeCodeConfigured: Boolean(this.publicPhoneAuthConfig.numberAuthSchemeCode),
      },
      maskedSecrets: {
        openaiApiKey: maskSecret(this.openaiApiKey, { keepStart: 4, keepEnd: 4 }),
        resendApiKey: maskSecret(this.resendApiKey, { keepStart: 4, keepEnd: 4 }),
        aliyunAccessKeyId: maskSecret(this.aliyunAccessKeyId, { keepStart: 4, keepEnd: 3 }),
        aliyunAccessKeySecret: maskSecret(this.aliyunAccessKeySecret, { keepStart: 4, keepEnd: 3 }),
      },
    };
  },
};

module.exports = config;

