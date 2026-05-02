#!/usr/bin/env node
/**
 * @file scripts/test-admin-users-page.js
 * @description Smoke test for admin user management cards, quota snapshots and page render.
 */

'use strict';

const assert = require('assert/strict');
const path = require('path');
const ejs = require('ejs');

const { waitReady } = require('../src/lib/db');
const { listPlans } = require('../src/services/plan-service');
const { listUsersWithPlans, getAdminOverview } = require('../src/services/admin-service');

async function main() {
  await waitReady();

  const [overview, users, plans] = await Promise.all([
    getAdminOverview(),
    listUsersWithPlans(),
    listPlans(),
  ]);

  assert.ok(Array.isArray(users), 'users list should be an array');
  assert.ok(users.every((user) => Object.prototype.hasOwnProperty.call(user, 'quota_snapshot')), 'every admin user row should expose quota_snapshot');

  const html = await ejs.renderFile(path.join(process.cwd(), 'src/views/admin.ejs'), {
    title: '管理员后台',
    appName: '楼阁',
    overview,
    users,
    plans,
    cspNonce: 'test-nonce',
    t: (text) => text,
    locals: {},
  });

  assert.match(html, /套餐余量/, 'admin page should render quota section');
  assert.match(html, /请求余量/, 'admin page should render request remaining');
  assert.match(html, /Token 余量/, 'admin page should render token remaining');
  assert.match(html, /quota-bar--admin/, 'admin page should render animated quota bars');
  assert.match(html, /用户当前套餐、请求余量、Token 余量/, 'admin page should include updated user management copy');

  console.log(JSON.stringify({
    status: 'passed',
    users: users.length,
    plans: plans.length,
    checks: [
      'listUsersWithPlans quota snapshots',
      'admin.ejs user quota render',
      'admin quota animation markup',
    ],
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
