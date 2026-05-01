/**
 * @file src/lib/db.js
 * @description
 * 数据库访问抽象层，对上层代码屏蔽底层数据库类型。
 *
 * 初始化策略（按优先级顺序）：
 *   1. 若环境变量 DATABASE_URL 已设置 → 尝试连接 MySQL
 *   2. MySQL 连接失败 或 DATABASE_URL 未设置 → 自动降级到本地 SQLite（data/local.db）
 *
 * 公共 API：
 *   query(sql, params)            通用查询。SELECT 返回行数组，INSERT 返回 { insertId, affectedRows }。
 *   withTransaction(callback)     原子事务。callback 接收具备 execute(sql, params) 方法的连接对象。
 *   getDbType()                   返回 'mysql' | 'sqlite' | 'none'。
 *   waitReady()                   等待初始化完成，应用启动时调用一次。
 *
 * 注意：
 *   - 参数占位符统一使用 `?`（mysql2 与 node:sqlite 均支持）。
 *   - SQLite 模式下自动注册 NOW() 自定义函数，兼容现有 SQL 语句。
 *   - SQLite 模式下，date 值以 'YYYY-MM-DD HH:MM:SS' 格式存储为 TEXT。
 */

'use strict';

const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const config = require('../config');

// ─── 内部状态 ─────────────────────────────────────────────────────────────────

/** 当前使用的数据库类型，初始化后不再变化。 */
let _dbType = 'none';

/** MySQL 连接池（仅 MySQL 模式有值）。 */
let _pool = null;

/** SQLite 数据库实例（仅 SQLite 模式有值）。 */
let _sqliteDb = null;

/** 初始化 Promise，所有公共 API 在返回前均会 await 此 Promise。 */
let _initPromise = null;

// ─── SQLite 兼容层 ────────────────────────────────────────────────────────────

/**
 * 将 MySQL 风格的 SQL 转换为 SQLite 可接受的语法。
 * 仅处理 CREATE TABLE / ALTER TABLE 中的已知差异，不修改 DML 语句的业务逻辑。
 *
 * @param {string} sql
 * @returns {string}
 */
function toSqliteDialect(sql) {
  return sql
    // 数据类型映射
    .replace(/\bBIGINT\b/gi, 'INTEGER')
    .replace(/\bINT\(\d+\)/gi, 'INTEGER')
    .replace(/\bTINYINT\(\d+\)/gi, 'INTEGER')
    .replace(/\bSMALLINT\b/gi, 'INTEGER')
    .replace(/\bMEDIUMINT\b/gi, 'INTEGER')
    .replace(/\bVARCHAR\(\d+\)/gi, 'TEXT')
    .replace(/\bCHAR\(\d+\)/gi, 'TEXT')
    .replace(/\bLONGTEXT\b/gi, 'TEXT')
    .replace(/\bMEDIUMTEXT\b/gi, 'TEXT')
    // (?!\s*\() 排除函数调用形式（如 datetime('now',...)、date('now',...)），只替换列类型声明
    .replace(/\bDATETIME\b(?!\s*\()/gi, 'TEXT')
    .replace(/\bDATE\b(?!\s*\()/gi, 'TEXT')
    .replace(/\bTIMESTAMP\b(?!\s*\()/gi, 'TEXT')
    .replace(/\bENUM\([^)]+\)/gi, 'TEXT')
    .replace(/\bJSON\b/gi, 'TEXT')
    .replace(/\bDECIMAL\(\d+,\s*\d+\)/gi, 'REAL')
    .replace(/\bFLOAT\b/gi, 'REAL')
    .replace(/\bDOUBLE\b/gi, 'REAL')
    // MySQL 关键字 / 存储选项（SQLite 不支持）
    .replace(/\bAUTO_INCREMENT\b/gi, 'AUTOINCREMENT')
    .replace(/ENGINE\s*=\s*\w+/gi, '')
    .replace(/DEFAULT\s+CHARSET\s*=\s*\w+/gi, '')
    .replace(/COLLATE\s*=?\s*[\w_]+/gi, '')
    .replace(/CHARACTER\s+SET\s+\w+/gi, '')
    // 外键约束（SQLite 可选支持，由 PRAGMA foreign_keys 控制；此处保留以避免语法错误）
    .replace(/,\s*CONSTRAINT\s+\w+\s+FOREIGN\s+KEY[^,)]*REFERENCES[^,)]*/gi, '')
    // CREATE TABLE 内的内联索引定义（SQLite 不支持，改用独立 CREATE INDEX 语句）
    .replace(/,\s*INDEX\s+\w+\s*\([^)]+\)/gi, '')
    .replace(/,\s*UNIQUE\s+INDEX\s+\w+\s*\([^)]+\)/gi, '')
    .replace(/,\s*KEY\s+\w+\s*\([^)]+\)/gi, '');
}

/**
 * 在 SQLite 实例上执行 SQL，并将结果标准化为与 mysql2 相同的返回形状：
 *   - SELECT / WITH → 行对象数组（null-prototype 对象已展开为普通对象）
 *   - INSERT        → { insertId: number, affectedRows: number }
 *   - 其他 DML      → { affectedRows: number }
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} sql
 * @param {any[]} params
 * @returns {any}
 */
function sqliteExec(db, sql, params = []) {
  const normalized = toSqliteDialect(sql.trim());
  const upper = normalized.trimStart().toUpperCase();

  const stmt = db.prepare(normalized);

  if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
    // 将 null-prototype 对象转为普通对象，确保下游代码（JSON.stringify、EJS 等）兼容
    return stmt.all(...params).map((row) => ({ ...row }));
  }

  const info = stmt.run(...params);

  if (upper.startsWith('INSERT')) {
    return { insertId: Number(info.lastInsertRowid), affectedRows: info.changes };
  }

  return { affectedRows: info.changes };
}

// ─── 数据库初始化 ─────────────────────────────────────────────────────────────

/**
 * 尝试创建 MySQL 连接池并验证连通性（3 秒连接超时）。
 * 成功返回连接池实例；失败抛出错误（由调用方决定是否降级）。
 *
 * @returns {Promise<import('mysql2/promise').Pool>}
 */
async function initMySQL() {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    uri: config.databaseUrl,
    connectionLimit: 10,
    charset: 'utf8mb4',
    connectTimeout: 3000,
    waitForConnections: true,
    queueLimit: 0,
  });

  // 获取一个连接作为连通性验证，随即归还
  const conn = await pool.getConnection();
  conn.release();

  return pool;
}

/**
 * 初始化本地 SQLite 数据库：
 *   - 自动创建 <项目根>/data/ 目录（如不存在）
 *   - 开启 WAL 模式与外键约束
 *   - 注册 NOW() 等 MySQL 兼容函数
 *   - 首次创建时运行完整 schema 初始化
 *
 * Node.js 内置的 node:sqlite 模块在 v22–v24 仍处于实验阶段，
 * 会打印 ExperimentalWarning。此处仅过滤该特定警告，不影响其他告警。
 *
 * @returns {import('node:sqlite').DatabaseSync}
 */
function initSQLite() {
  // 过滤 node:sqlite 的 ExperimentalWarning，避免干扰日志输出
  const _emitWarning = process.emitWarning.bind(process);
  process.emitWarning = function (warning, ...rest) {
    if (typeof warning === 'string' && warning.includes('SQLite is an experimental feature')) {
      return;
    }
    return _emitWarning(warning, ...rest);
  };
  const { DatabaseSync } = require('node:sqlite');
  // DatabaseSync 已加载，恢复原始 emitWarning 以不影响后续其他模块的警告
  process.emitWarning = _emitWarning;

  const dataDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'local.db');
  const isNewDatabase = !fs.existsSync(dbPath);

  const db = new DatabaseSync(dbPath);

  // 性能与安全基线配置
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  // ── 注册 MySQL 兼容函数 ──────────────────────────────────────────────────────
  // 让现有 INSERT / UPDATE 语句中的 NOW() 调用无需修改即可在 SQLite 上运行

  /** 返回当前时间字符串，格式：'YYYY-MM-DD HH:MM:SS' */
  db.function('NOW', () => new Date().toISOString().replace('T', ' ').slice(0, 19));

  // 提取日期部分（部分查询中使用）
  db.function('YEAR',  (d) => d ? new Date(d).getFullYear() : null);
  db.function('MONTH', (d) => d ? new Date(d).getMonth() + 1 : null);
  db.function('DAY',   (d) => d ? new Date(d).getDate() : null);

  logger.info('[db] SQLite 数据库已打开', { path: dbPath, isNewDatabase });

  // 首次创建或历史库升级：运行幂等 schema 初始化（建表 + 补列 + 种子数据）
  const { initSqliteSchema } = require('./db-sqlite-schema');
  initSqliteSchema(db);
  logger.info('[db] SQLite 表结构检查完成', { initialized: isNewDatabase });

  return db;
}

/**
 * 主初始化流程：MySQL 优先，失败时降级到 SQLite。
 * 模块加载时自动调用，结果通过 _initPromise 供外部 await。
 */
async function initialize() {
  if (config.databaseUrl) {
    try {
      _pool = await initMySQL();
      _dbType = 'mysql';
      logger.info('[db] MySQL 连接成功，使用 MySQL 模式');
      return;
    } catch (error) {
      logger.warn('[db] MySQL 连接失败，自动降级到 SQLite', {
        error: error.message,
        hint: '如需使用 MySQL，请检查 DATABASE_URL 与网络/防火墙配置',
      });
    }
  } else {
    logger.info('[db] DATABASE_URL 未设置，使用 SQLite 本地数据库（开发模式）');
  }

  _sqliteDb = initSQLite();
  _dbType = 'sqlite';
}

// 模块加载时立即异步初始化，后续所有 query / withTransaction 均等待此 Promise
_initPromise = initialize().catch((err) => {
  logger.error('[db] 数据库初始化失败，应用无法启动', { error: err.message });
  throw err;
});

// ─── 公共 API ─────────────────────────────────────────────────────────────────

/**
 * 等待数据库初始化完成。
 * 建议在应用启动的 bootstrap() 函数中调用，确认数据库就绪后再开始监听请求。
 *
 * @returns {Promise<void>}
 *
 * @example
 * await waitReady();
 * app.listen(port);
 */
async function waitReady() {
  await _initPromise;
}

/**
 * 返回当前正在使用的数据库类型。
 *
 * @returns {'mysql' | 'sqlite' | 'none'}
 */
function getDbType() {
  return _dbType;
}

/**
 * 执行 SQL 查询，自动适配当前数据库类型。
 *
 * 参数占位符统一使用 `?`（与 mysql2 一致，SQLite 同样支持）。
 *
 * 返回值形状：
 *   - SELECT / WITH → 行数组 `Array<Object>`
 *   - INSERT        → `{ insertId: number, affectedRows: number }`
 *   - 其他 DML      → `{ affectedRows: number }`
 *
 * @param {string} sql     SQL 语句，参数占位符使用 ?
 * @param {any[]} [params=[]]  按位置传入的参数
 * @returns {Promise<any>}
 *
 * @example
 * // SELECT
 * const users = await query('SELECT * FROM users WHERE id = ?', [userId]);
 *
 * // INSERT
 * const r = await query('INSERT INTO items (name) VALUES (?)', ['苹果']);
 * console.log(r.insertId); // 新插入行的 ID
 */
async function query(sql, params = []) {
  await _initPromise;

  if (_dbType === 'mysql') {
    const [rows] = await _pool.execute(sql, params);
    return rows;
  }

  if (_dbType === 'sqlite') {
    return sqliteExec(_sqliteDb, sql, params);
  }

  throw new Error('[db] 数据库未就绪，请等待初始化完成');
}

/**
 * 在数据库事务中执行一组操作，确保原子性（要么全部成功，要么全部回滚）。
 *
 * callback 接收一个具备 execute(sql, params) 方法的"连接"对象：
 *   - MySQL：真实数据库连接，支持标准 BEGIN / COMMIT / ROLLBACK。
 *   - SQLite：使用 SQLite 的 BEGIN / COMMIT / ROLLBACK 语句模拟事务。
 *
 * execute() 返回格式与 mysql2 的 connection.execute() 保持一致：
 *   - SELECT → [rowsArray, []]
 *   - INSERT → [{ insertId, affectedRows }, []]
 *   - 其他   → [{ affectedRows }, []]
 *
 * @template T
 * @param {(conn: { execute(sql: string, params?: any[]): Promise<[any, any[]]> }) => Promise<T>} callback
 * @returns {Promise<T>}
 *
 * @example
 * const userId = await withTransaction(async (conn) => {
 *   const [r] = await conn.execute('INSERT INTO users (name, created_at) VALUES (?, NOW())', ['Alice']);
 *   await conn.execute('INSERT INTO profiles (user_id) VALUES (?)', [r.insertId]);
 *   return r.insertId;
 * });
 */
async function withTransaction(callback) {
  await _initPromise;

  if (_dbType === 'mysql') {
    const conn = await _pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await callback({
        execute: (sql, params = []) => conn.execute(sql, params),
        query:   (sql, params = []) => conn.query(sql, params),
      });
      await conn.commit();
      logger.debug('[db] 事务提交成功');
      return result;
    } catch (err) {
      await conn.rollback();
      logger.warn('[db] 事务回滚', { error: err.message });
      throw err;
    } finally {
      conn.release();
    }
  }

  if (_dbType === 'sqlite') {
    _sqliteDb.exec('BEGIN');
    try {
      const tx = {
        /**
         * 在事务上下文中执行一条 SQL，返回形状与 mysql2 connection.execute() 相同。
         *
         * @param {string} sql
         * @param {any[]} [params=[]]
         * @returns {Promise<[any, any[]]>}
         */
        execute: (sql, params = []) => {
          const result = sqliteExec(_sqliteDb, sql, params);
          // mysql2 execute() 返回 [result, fields]；此处模拟相同格式
          return Promise.resolve([result, []]);
        },
      };

      const result = await callback(tx);
      _sqliteDb.exec('COMMIT');
      logger.debug('[db] SQLite 事务提交成功');
      return result;
    } catch (err) {
      try { _sqliteDb.exec('ROLLBACK'); } catch (_) { /* ignore rollback error */ }
      logger.warn('[db] SQLite 事务回滚', { error: err.message });
      throw err;
    }
  }

  throw new Error('[db] 数据库未就绪，请等待初始化完成');
}

module.exports = {
  waitReady,
  getDbType,
  query,
  withTransaction,
};
