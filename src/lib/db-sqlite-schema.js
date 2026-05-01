/**
 * @file src/lib/db-sqlite-schema.js
 * @description SQLite 数据库表结构初始化入口，按领域委托给 src/lib/sqlite-schema/*。
 */

'use strict';

const { ensureSqliteUsersSchema } = require('./sqlite-schema/users');
const { ensureSqlitePlansSchema } = require('./sqlite-schema/plans');
const { ensureSqliteSubscriptionsSchema } = require('./sqlite-schema/subscriptions');
const { ensureSqliteLlmSchema } = require('./sqlite-schema/llm');
const { ensureSqlitePromptNotificationSchema } = require('./sqlite-schema/prompts-notifications');
const { ensureSqliteCharacterConversationSchema } = require('./sqlite-schema/characters-conversations');
const { seedSqliteDefaults } = require('./sqlite-schema/seed');

function initSqliteSchema(db) {
  ensureSqliteUsersSchema(db);
  ensureSqlitePlansSchema(db);
  ensureSqliteSubscriptionsSchema(db);
  ensureSqliteLlmSchema(db);
  ensureSqlitePromptNotificationSchema(db);
  ensureSqliteCharacterConversationSchema(db);
  seedSqliteDefaults(db);
}

module.exports = { initSqliteSchema };
