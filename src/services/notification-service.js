/**
 * @file src/services/notification-service.js
 * @description 站内通知与客服入口配置服务。调用说明：管理后台维护通知规则与客服入口外部资源，布局与聊天页通过公开接口读取当前用户可见通知。
 */

'use strict';

const { query, getDbType, waitReady } = require('../lib/db');
const logger = require('../lib/logger');

const DEFAULT_SUPPORT_QR_URL = 'https://work.weixin.qq.com/u/vc4a43a573988025fe?v=5.0.7.68221&bb=66637a4084';

const VALID_NOTIFICATION_TYPES = new Set(['general', 'new_user', 'support', 'error', 'maintenance']);
const VALID_DISPLAY_POSITIONS = new Set(['modal', 'toast', 'banner']);
const VALID_AUDIENCES = new Set(['all', 'guest', 'user', 'admin']);

const TRUTHY_VALUES = new Set(['1', 'true', 'on', 'yes', 'y']);

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  return TRUTHY_VALUES.has(String(value || '').trim().toLowerCase()) ? 1 : 0;
}

function normalizeString(value, maxLength = 255) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeChoice(value, allowedSet, fallback) {
  const normalized = normalizeString(value, 80);
  return allowedSet.has(normalized) ? normalized : fallback;
}

function normalizeOptionalDate(value) {
  const raw = normalizeString(value, 40);
  if (!raw) return null;
  // datetime-local: 2026-05-01T03:30 → SQL-friendly: 2026-05-01 03:30:00
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    return raw.replace('T', ' ').slice(0, 16) + ':00';
  }
  return raw;
}

function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function decodeNotification(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    is_active: Number(row.is_active || 0),
    force_display: Number(row.force_display || 0),
    show_once: Number(row.show_once || 0),
    new_user_only: Number(row.new_user_only || 0),
    priority: Number(row.priority || 0),
    display_duration_ms: Number(row.display_duration_ms || 0),
  };
}

function formatDateForInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(' ', 'T').slice(0, 16);
}

async function ensureNotificationSchema() {
  await waitReady();
  if (getDbType() === 'mysql') {
    await query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(120) NOT NULL,
        body TEXT NOT NULL,
        notification_type ENUM('general','new_user','support','error','maintenance') NOT NULL DEFAULT 'general',
        audience ENUM('all','guest','user','admin') NOT NULL DEFAULT 'all',
        display_position ENUM('modal','toast','banner') NOT NULL DEFAULT 'modal',
        display_duration_ms INT NOT NULL DEFAULT 0,
        force_display TINYINT(1) NOT NULL DEFAULT 0,
        show_once TINYINT(1) NOT NULL DEFAULT 0,
        new_user_only TINYINT(1) NOT NULL DEFAULT 0,
        support_qr_url VARCHAR(500) NULL,
        action_label VARCHAR(80) NULL,
        action_url VARCHAR(500) NULL,
        starts_at DATETIME NULL,
        ends_at DATETIME NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        priority INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        INDEX idx_notifications_active_window (is_active, starts_at, ends_at),
        INDEX idx_notifications_audience (audience, notification_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      notification_type TEXT NOT NULL DEFAULT 'general',
      audience TEXT NOT NULL DEFAULT 'all',
      display_position TEXT NOT NULL DEFAULT 'modal',
      display_duration_ms INTEGER NOT NULL DEFAULT 0,
      force_display INTEGER NOT NULL DEFAULT 0,
      show_once INTEGER NOT NULL DEFAULT 0,
      new_user_only INTEGER NOT NULL DEFAULT 0,
      support_qr_url TEXT NULL,
      action_label TEXT NULL,
      action_url TEXT NULL,
      starts_at TEXT NULL,
      ends_at TEXT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_notifications_active_window ON notifications (is_active, starts_at, ends_at)');
  await query('CREATE INDEX IF NOT EXISTS idx_notifications_audience ON notifications (audience, notification_type)');
}

async function seedSupportNotificationIfEmpty() {
  await ensureNotificationSchema();
  const rows = await query('SELECT COUNT(*) AS count FROM notifications');
  if (Number(rows?.[0]?.count || 0) > 0) return;

  await query(
    `INSERT INTO notifications (
      title, body, notification_type, audience, display_position, display_duration_ms,
      force_display, show_once, new_user_only, support_qr_url, action_label, action_url,
      starts_at, ends_at, is_active, priority, created_at, updated_at
    ) VALUES (?, ?, 'support', 'all', 'modal', 0, 0, 0, 0, ?, ?, ?, NULL, NULL, 1, 10, NOW(), NOW())`,
    [
      '需要客服协助？',
      '如果遇到报错、额度异常或页面状态不对，可以打开客服入口，使用微信扫码联系工作人员。',
      DEFAULT_SUPPORT_QR_URL,
      '联系客服',
      DEFAULT_SUPPORT_QR_URL,
    ],
  );
}

async function listNotificationsForAdmin() {
  await seedSupportNotificationIfEmpty();
  const rows = await query('SELECT * FROM notifications ORDER BY is_active DESC, priority DESC, id DESC');
  return rows.map((row) => ({
    ...decodeNotification(row),
    starts_at_input: formatDateForInput(row.starts_at),
    ends_at_input: formatDateForInput(row.ends_at),
  }));
}

function buildNotificationPayload(payload = {}) {
  const title = normalizeString(payload.title, 120);
  const body = normalizeString(payload.body, 4000);
  if (!title) throw new Error('通知标题不能为空。');
  if (!body) throw new Error('通知内容不能为空。');

  const notificationType = normalizeChoice(payload.notificationType || payload.notification_type, VALID_NOTIFICATION_TYPES, 'general');
  const showOnce = normalizeBoolean(payload.showOnce || payload.show_once);
  const explicitNewUserOnly = payload.newUserOnly !== undefined || payload.new_user_only !== undefined;
  const newUserOnly = explicitNewUserOnly
    ? normalizeBoolean(payload.newUserOnly || payload.new_user_only)
    : (notificationType === 'new_user' ? 1 : 0);

  return {
    title,
    body,
    notificationType,
    audience: normalizeChoice(payload.audience, VALID_AUDIENCES, 'all'),
    displayPosition: normalizeChoice(payload.displayPosition || payload.display_position, VALID_DISPLAY_POSITIONS, 'modal'),
    displayDurationMs: Math.max(0, toNumber(payload.displayDurationMs || payload.display_duration_ms, 0)),
    forceDisplay: normalizeBoolean(payload.forceDisplay || payload.force_display),
    showOnce,
    newUserOnly,
    supportQrUrl: normalizeString(payload.supportQrUrl || payload.support_qr_url, 500) || null,
    actionLabel: normalizeString(payload.actionLabel || payload.action_label, 80) || null,
    actionUrl: normalizeString(payload.actionUrl || payload.action_url, 500) || null,
    startsAt: normalizeOptionalDate(payload.startsAt || payload.starts_at),
    endsAt: normalizeOptionalDate(payload.endsAt || payload.ends_at),
    isActive: normalizeBoolean(payload.isActive || payload.is_active),
    priority: toNumber(payload.priority, 0) || 0,
  };
}

async function createNotification(payload) {
  await ensureNotificationSchema();
  const data = buildNotificationPayload(payload);
  const result = await query(
    `INSERT INTO notifications (
      title, body, notification_type, audience, display_position, display_duration_ms,
      force_display, show_once, new_user_only, support_qr_url, action_label, action_url,
      starts_at, ends_at, is_active, priority, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      data.title,
      data.body,
      data.notificationType,
      data.audience,
      data.displayPosition,
      data.displayDurationMs,
      data.forceDisplay,
      data.showOnce,
      data.newUserOnly,
      data.supportQrUrl,
      data.actionLabel,
      data.actionUrl,
      data.startsAt,
      data.endsAt,
      data.isActive,
      data.priority,
    ],
  );
  return result.insertId;
}

async function updateNotification(id, payload) {
  await ensureNotificationSchema();
  const notificationId = Number(id);
  if (!Number.isFinite(notificationId) || notificationId <= 0) {
    throw new Error('通知 ID 不正确。');
  }
  const data = buildNotificationPayload(payload);
  await query(
    `UPDATE notifications
     SET title = ?, body = ?, notification_type = ?, audience = ?, display_position = ?, display_duration_ms = ?,
         force_display = ?, show_once = ?, new_user_only = ?, support_qr_url = ?, action_label = ?, action_url = ?,
         starts_at = ?, ends_at = ?, is_active = ?, priority = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      data.title,
      data.body,
      data.notificationType,
      data.audience,
      data.displayPosition,
      data.displayDurationMs,
      data.forceDisplay,
      data.showOnce,
      data.newUserOnly,
      data.supportQrUrl,
      data.actionLabel,
      data.actionUrl,
      data.startsAt,
      data.endsAt,
      data.isActive,
      data.priority,
      notificationId,
    ],
  );
}

async function deleteNotification(id) {
  await ensureNotificationSchema();
  await query('DELETE FROM notifications WHERE id = ?', [Number(id)]);
}

function isNotificationVisibleToUser(notification, user) {
  if (!notification || Number(notification.is_active || 0) !== 1) return false;
  const audience = String(notification.audience || 'all');
  if (audience === 'guest' && user) return false;
  if (audience === 'user' && !user) return false;
  if (audience === 'admin' && user?.role !== 'admin') return false;
  if (Number(notification.new_user_only || 0) === 1 && user) {
    const createdAt = new Date(notification.user_created_at || user.created_at || 0).getTime();
    if (Number.isFinite(createdAt) && Date.now() - createdAt > 7 * 24 * 60 * 60 * 1000) {
      return false;
    }
  }
  return true;
}

async function listActiveNotificationsForUser(user = null, options = {}) {
  await seedSupportNotificationIfEmpty();
  const supportOnly = normalizeBoolean(options.supportOnly || false) === 1;
  const params = [];
  let sql = `
    SELECT * FROM notifications
    WHERE is_active = 1
      AND (starts_at IS NULL OR starts_at <= NOW())
      AND (ends_at IS NULL OR ends_at >= NOW())
  `;
  if (supportOnly) {
    sql += " AND notification_type = 'support'";
  } else {
    // 客服入口是被动支持资源，只在报错页、聊天失败或用户主动求助时调用；
    // 不参与页面初始化通知，否则会在每次刷新时弹出。
    sql += " AND notification_type <> 'support'";
  }
  sql += ' ORDER BY force_display DESC, priority DESC, id DESC LIMIT 20';

  const rows = await query(sql, params);
  return rows
    .map(decodeNotification)
    .filter((notification) => isNotificationVisibleToUser(notification, user))
    .map((notification) => ({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      notificationType: notification.notification_type,
      audience: notification.audience,
      displayPosition: notification.display_position,
      displayDurationMs: notification.display_duration_ms,
      forceDisplay: notification.force_display === 1,
      showOnce: notification.show_once === 1,
      newUserOnly: notification.new_user_only === 1,
      supportQrUrl: notification.support_qr_url || '',
      actionLabel: notification.action_label || '',
      actionUrl: notification.action_url || '',
      priority: notification.priority,
    }));
}

async function getClientNotificationBootstrap(user = null) {
  try {
    return await listActiveNotificationsForUser(user);
  } catch (error) {
    logger.warn('[notification-service] 通知加载失败，前端降级为空', { error: error.message });
    return [];
  }
}

module.exports = {
  DEFAULT_SUPPORT_QR_URL,
  ensureNotificationSchema,
  listNotificationsForAdmin,
  listActiveNotificationsForUser,
  getClientNotificationBootstrap,
  createNotification,
  updateNotification,
  deleteNotification,
};
