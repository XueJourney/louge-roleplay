/**
 * @file src/services/site-message-service.js
 * @description 站内信服务：管理员批量投递、用户收件箱、未读轮询与已读状态。
 */

'use strict';

const { query, getDbType, waitReady, withTransaction } = require('../lib/db');

const VALID_TARGET_MODES = new Set(['all', 'filtered', 'users']);
const VALID_ROLES = new Set(['any', 'user', 'admin']);
const VALID_STATUSES = new Set(['any', 'active', 'blocked']);
const TRUTHY_VALUES = new Set(['1', 'true', 'on', 'yes', 'y']);

function normalizeString(value, maxLength = 255) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  return TRUTHY_VALUES.has(String(value || '').trim().toLowerCase()) ? 1 : 0;
}

function normalizeChoice(value, allowedSet, fallback) {
  const normalized = normalizeString(value, 80);
  return allowedSet.has(normalized) ? normalized : fallback;
}

function isDuplicateColumnError(error) {
  return /duplicate column|already exists/i.test(String(error?.message || ''));
}

function isDuplicateIndexError(error) {
  return /duplicate key|already exists/i.test(String(error?.message || ''));
}

function normalizeUserIdList(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\s,，;；]+/);
  return Array.from(new Set(source
    .map((item) => Number(String(item || '').trim()))
    .filter((item) => Number.isFinite(item) && item > 0)));
}

function buildMessagePayload(payload = {}) {
  const title = normalizeString(payload.title, 120);
  const body = normalizeString(payload.body, 6000);
  if (!title) throw new Error('站内信标题不能为空。');
  if (!body) throw new Error('站内信内容不能为空。');

  const targetMode = normalizeChoice(payload.targetMode || payload.target_mode, VALID_TARGET_MODES, 'all');
  const filterRole = normalizeChoice(payload.filterRole || payload.filter_role, VALID_ROLES, 'any');
  const filterStatus = normalizeChoice(payload.filterStatus || payload.filter_status, VALID_STATUSES, 'any');
  const filterPlanCode = normalizeString(payload.filterPlanCode || payload.filter_plan_code, 50);
  const userIds = normalizeUserIdList(payload.userIds || payload.user_ids);

  if (targetMode === 'users' && !userIds.length) {
    throw new Error('请至少填写一个用户 ID。');
  }

  return {
    title,
    body,
    targetMode,
    filterRole,
    filterStatus,
    filterPlanCode,
    userIds,
    isImportant: normalizeBoolean(payload.isImportant || payload.is_important),
  };
}

async function ensureSiteMessageSchema() {
  await waitReady();

  if (getDbType() === 'mysql') {
    await query(`
      CREATE TABLE IF NOT EXISTS site_messages (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(120) NOT NULL,
        body TEXT NOT NULL,
        sender_admin_user_id BIGINT NULL,
        target_mode ENUM('all','filtered','users') NOT NULL DEFAULT 'all',
        filter_role ENUM('any','user','admin') NOT NULL DEFAULT 'any',
        filter_status ENUM('any','active','blocked') NOT NULL DEFAULT 'any',
        filter_plan_code VARCHAR(50) NULL,
        is_important TINYINT(1) NOT NULL DEFAULT 0,
        recipient_count INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        INDEX idx_site_messages_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS site_message_recipients (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        message_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        read_at DATETIME NULL,
        created_at DATETIME NOT NULL,
        UNIQUE INDEX uniq_site_message_recipient (message_id, user_id),
        INDEX idx_site_message_recipients_user_read (user_id, is_read, created_at),
        CONSTRAINT fk_site_message_recipients_message FOREIGN KEY (message_id) REFERENCES site_messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_site_message_recipients_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Historical self-healing for partially-created tables.
    await query("ALTER TABLE site_messages ADD COLUMN is_important TINYINT(1) NOT NULL DEFAULT 0").catch((error) => {
      if (!isDuplicateColumnError(error)) throw error;
    });
    await query('CREATE INDEX idx_site_messages_created ON site_messages (created_at)').catch((error) => {
      if (!isDuplicateIndexError(error)) throw error;
    });
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS site_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      sender_admin_user_id INTEGER NULL,
      target_mode TEXT NOT NULL DEFAULT 'all',
      filter_role TEXT NOT NULL DEFAULT 'any',
      filter_status TEXT NOT NULL DEFAULT 'any',
      filter_plan_code TEXT NULL,
      is_important INTEGER NOT NULL DEFAULT 0,
      recipient_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS site_message_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_site_message_recipient ON site_message_recipients (message_id, user_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_site_message_recipients_user_read ON site_message_recipients (user_id, is_read, created_at)');
  await query('CREATE INDEX IF NOT EXISTS idx_site_messages_created ON site_messages (created_at)');
}

async function resolveRecipients(data) {
  const params = [];
  let sql = `
    SELECT DISTINCT u.id
    FROM users u
    LEFT JOIN user_subscriptions us ON us.user_id = u.id AND us.status = 'active'
    LEFT JOIN plans p ON p.id = us.plan_id
    WHERE 1 = 1
  `;

  if (data.targetMode === 'users') {
    sql += ` AND u.id IN (${data.userIds.map(() => '?').join(',')})`;
    params.push(...data.userIds);
  } else if (data.targetMode === 'filtered') {
    if (data.filterRole !== 'any') {
      sql += ' AND u.role = ?';
      params.push(data.filterRole);
    }
    if (data.filterStatus !== 'any') {
      sql += ' AND u.status = ?';
      params.push(data.filterStatus);
    }
    if (data.filterPlanCode) {
      sql += ' AND p.code = ?';
      params.push(data.filterPlanCode);
    }
  }

  sql += ' ORDER BY u.id ASC';
  const rows = (await query(sql, params)).slice(0, 5000);
  return rows.map((row) => Number(row.id)).filter((id) => id > 0);
}

async function createSiteMessage(payload, senderAdminUserId = null) {
  await ensureSiteMessageSchema();
  const data = buildMessagePayload(payload);
  const recipientIds = await resolveRecipients(data);
  if (!recipientIds.length) {
    throw new Error('没有匹配到可投递的用户。');
  }

  return withTransaction(async (conn) => {
    const [messageResult] = await conn.execute(
      `INSERT INTO site_messages (
        title, body, sender_admin_user_id, target_mode, filter_role, filter_status,
        filter_plan_code, is_important, recipient_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        data.title,
        data.body,
        senderAdminUserId ? Number(senderAdminUserId) : null,
        data.targetMode,
        data.filterRole,
        data.filterStatus,
        data.filterPlanCode || null,
        data.isImportant,
        recipientIds.length,
      ],
    );
    const messageId = Number(messageResult.insertId);
    for (const userId of recipientIds) {
      await conn.execute(
        'INSERT INTO site_message_recipients (message_id, user_id, is_read, created_at) VALUES (?, ?, 0, NOW())',
        [messageId, userId],
      );
    }
    return { messageId, recipientCount: recipientIds.length };
  });
}

async function listSiteMessagesForAdmin(limit = 50) {
  await ensureSiteMessageSchema();
  return query(
    `SELECT sm.*, u.username AS sender_username
     FROM site_messages sm
     LEFT JOIN users u ON u.id = sm.sender_admin_user_id
     ORDER BY sm.id DESC`,
    [],
  ).then((rows) => rows.slice(0, Math.max(1, Math.min(100, Number(limit || 50)))));
}

async function listInboxMessagesForUser(userId, { unreadOnly = false, limit = 50 } = {}) {
  await ensureSiteMessageSchema();
  const params = [Number(userId)];
  let sql = `
    SELECT smr.id AS recipient_id, smr.is_read, smr.read_at, smr.created_at AS delivered_at,
           sm.id, sm.title, sm.body, sm.is_important, sm.created_at
    FROM site_message_recipients smr
    JOIN site_messages sm ON sm.id = smr.message_id
    WHERE smr.user_id = ?
  `;
  if (unreadOnly) {
    sql += ' AND smr.is_read = 0';
  }
  sql += ' ORDER BY smr.is_read ASC, sm.is_important DESC, sm.id DESC';
  const rows = await query(sql, params);
  return rows.slice(0, Math.max(1, Math.min(100, Number(limit || 50))));
}

async function getUnreadSiteMessageCount(userId) {
  await ensureSiteMessageSchema();
  const rows = await query('SELECT COUNT(*) AS count FROM site_message_recipients WHERE user_id = ? AND is_read = 0', [Number(userId)]);
  return Number(rows[0]?.count || 0);
}

async function markSiteMessageRead(userId, messageId) {
  await ensureSiteMessageSchema();
  await query(
    'UPDATE site_message_recipients SET is_read = 1, read_at = NOW() WHERE user_id = ? AND message_id = ?',
    [Number(userId), Number(messageId)],
  );
}

async function markAllSiteMessagesRead(userId) {
  await ensureSiteMessageSchema();
  await query(
    'UPDATE site_message_recipients SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0',
    [Number(userId)],
  );
}

async function getSiteMessageRealtimeSnapshot(userId) {
  const [count, latest] = await Promise.all([
    getUnreadSiteMessageCount(userId),
    listInboxMessagesForUser(userId, { unreadOnly: true, limit: 5 }),
  ]);
  return { unreadCount: count, latest };
}

module.exports = {
  ensureSiteMessageSchema,
  createSiteMessage,
  listSiteMessagesForAdmin,
  listInboxMessagesForUser,
  getUnreadSiteMessageCount,
  markSiteMessageRead,
  markAllSiteMessagesRead,
  getSiteMessageRealtimeSnapshot,
};
