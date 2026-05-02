/**
 * @file scripts/init-db.js
 * @description
 * 数据库初始化脚本。根据当前配置自动选择初始化策略：
 *
 *   MySQL 模式（DATABASE_URL 已设置）：
 *     - 使用 DATABASE_ADMIN_URL 创建数据库（若不存在）
 *     - 创建全部业务表并补全历史缺失字段/索引（幂等，可反复执行）
 *     - 写入默认套餐与 LLM 提供商种子数据
 *
 *   SQLite 模式（DATABASE_URL 未设置）：
 *     - 表结构由 db.js 在首次连接时自动初始化，此脚本无需额外操作
 *     - 数据库文件路径：<项目根>/data/local.db
 *
 * 使用方式：
 *   npm run db:init
 *   或
 *   node scripts/init-db.js
 */

'use strict';

const mysql = require('mysql2/promise');
const config = require('../src/config');

const {
  getDatabaseNameFromUrl,
  quoteIdentifier,
} = require('./init-db/utils');
const { createSchemaHelpers } = require('./init-db/helpers');
const { backfillUserPublicIds, migratePresetModelsFromPlans } = require('./init-db/migrations');
const { ensureCharacterSchema, ensureChatSchema } = require('./init-db/character-chat-schema');
const { ensureMessagingAndProviderSchema, ensureUsersAndPlans } = require('./init-db/core-schema');
const { seedDefaults } = require('./init-db/seeds');

// ─── SQLite 模式：提示并退出 ──────────────────────────────────────────────────

if (!config.databaseUrl) {
  console.log('');
  console.log('[init-db] DATABASE_URL 未设置 → SQLite 模式');
  console.log('[init-db] SQLite 表结构将在应用首次启动时自动初始化（data/local.db）。');
  console.log('[init-db] 你现在可以直接运行 npm start 或 npm run dev。');
  console.log('');
  process.exit(0);
}

// ─── MySQL 模式：完整初始化 ───────────────────────────────────────────────────

async function main() {
  if (!config.databaseAdminUrl) {
    throw new Error('DATABASE_ADMIN_URL is required for MySQL mode (needed to CREATE DATABASE)');
  }

  console.log('[init-db] 开始 MySQL 数据库初始化...');
  const databaseName = getDatabaseNameFromUrl(config.databaseUrl);

  // 1. 用管理员连接创建 DATABASE_URL 指向的数据库（若不存在）
  const adminConnection = await mysql.createConnection(config.databaseAdminUrl);
  await adminConnection.query(
    `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(databaseName)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await adminConnection.end();
  console.log(`[init-db] 数据库 ${databaseName} 已就绪`);

  // 2. 使用业务连接创建/更新表结构
  const connection = await mysql.createConnection(config.databaseUrl);

  // ── 辅助函数：幂等添加列 / 索引 ─────────────────────────────────────────────
  const { ensureColumn, ensureIndex, ensureUniqueIndex } = createSchemaHelpers(connection);

  await ensureUsersAndPlans(connection, { ensureColumn, ensureIndex, ensureUniqueIndex }, backfillUserPublicIds);
  await ensureMessagingAndProviderSchema(connection, { ensureColumn, ensureIndex, ensureUniqueIndex });
  await ensureCharacterSchema(connection, { ensureColumn, ensureIndex, ensureUniqueIndex });
  await ensureChatSchema(connection, { ensureColumn, ensureIndex, ensureUniqueIndex });
  await seedDefaults(connection, config, migratePresetModelsFromPlans);

  await connection.end();
  console.log('[init-db] MySQL 数据库初始化完成。');
}

main().catch((error) => {
  console.error('[init-db] 初始化失败:', error.message);
  process.exit(1);
});
