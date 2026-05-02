#!/usr/bin/env node
/**
 * @file scripts/test-site-message-service.js
 * @description Regression checks for global site messages, revoke behavior, and admin history counts.
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const { query, waitReady } = require('../src/lib/db');
const {
  createSiteMessage,
  ensureGlobalMessagesForUser,
  listInboxMessagesForUser,
  getUnreadSiteMessageCount,
  revokeSiteMessage,
  listSiteMessagesForAdmin,
} = require('../src/services/site-message-service');

const suffix = Date.now();

async function insertUser(username) {
  const publicId = `SM${String(suffix).slice(-8)}${username.slice(-1)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const result = await query(
    `INSERT INTO users (
      public_id, username, password_hash, email, phone, country_type,
      email_verified, phone_verified, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, 'domestic', 0, 0, 'user', 'active', NOW(), NOW())`,
    [publicId, username, 'test-hash'],
  );
  return Number(result.insertId);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

(async () => {
  await waitReady();
  const firstUserId = await insertUser(`site_msg_first_${suffix}`);
  const secondUserId = await insertUser(`site_msg_second_${suffix}`);

  const created = await createSiteMessage({
    targetMode: 'all',
    title: `Global test ${suffix}`,
    body: 'Global site message body',
  }, firstUserId);

  assert(created.recipientCount >= 2, 'global message should be delivered to current users');

  let secondInbox = await listInboxMessagesForUser(secondUserId, { limit: 20 });
  assert(secondInbox.some((message) => Number(message.id) === Number(created.messageId)), 'current users should see global message');

  const laterUserId = await insertUser(`site_msg_later_${suffix}`);
  await ensureGlobalMessagesForUser(laterUserId);
  let laterInbox = await listInboxMessagesForUser(laterUserId, { limit: 20 });
  assert(laterInbox.some((message) => Number(message.id) === Number(created.messageId)), 'new users should see historical global message');

  const unreadBeforeRevoke = await getUnreadSiteMessageCount(laterUserId);
  assert(unreadBeforeRevoke > 0, 'historical global message should count as unread before revoke');

  const historyBeforeRevoke = await listSiteMessagesForAdmin(10);
  const historyMessage = historyBeforeRevoke.find((message) => Number(message.id) === Number(created.messageId));
  assert(historyMessage, 'admin history should include message');
  assert(Number(historyMessage.recipient_count) >= 3, 'admin history count should include users added after original send');

  const revoked = await revokeSiteMessage(created.messageId, firstUserId);
  assert(revoked, 'revokeSiteMessage should report first revoke as successful');

  secondInbox = await listInboxMessagesForUser(secondUserId, { limit: 20 });
  assert(!secondInbox.some((message) => Number(message.id) === Number(created.messageId)), 'revoked message should be hidden from inbox');

  laterInbox = await listInboxMessagesForUser(laterUserId, { limit: 20 });
  assert(!laterInbox.some((message) => Number(message.id) === Number(created.messageId)), 'revoked message should be hidden from new user inbox');

  const unreadAfterRevoke = await getUnreadSiteMessageCount(laterUserId);
  assert(unreadAfterRevoke === 0, 'revoked message should be excluded from unread count');

  console.log('site-message-service regression checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
