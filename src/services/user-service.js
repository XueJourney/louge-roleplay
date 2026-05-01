/**
 * @file src/services/user-service.js
 * @description
 * 用户账户服务：注册、登录查询、用户信息读取、角色变更。
 *
 * 所有写操作（createUser）通过 withTransaction() 保证原子性，
 * 兼容 MySQL 真实事务与 SQLite 的 BEGIN/COMMIT 模拟事务。
 *
 * 公共函数：
 *   createUser(options)              创建新用户并自动分配默认套餐，返回新用户 ID
 *   findUserByUsername(username)     按用户名查询
 *   findUserByEmail(email)           按邮箱查询
 *   findUserByPhone(phone)           按手机号查询
 *   findUserByLogin(login)           按用户名/邮箱/手机号任一查询（用于登录）
 *   findUserById(id)                 按 ID 查询（返回脱敏字段，不含密码哈希）
 *   findUserAuthById(id)             按 ID 查询用户完整认证字段（含密码哈希）
 *   updateUserRole(userId, role)     变更用户角色
 *   updateUsername(userId, username) 更新用户名
 *   updatePasswordHash(userId, hash) 更新密码哈希
 */

'use strict';

const { query, withTransaction } = require('../lib/db');
const { assignDefaultPlanToUser } = require('./plan-service');
const { generateUniqueUserPublicId } = require('../lib/user-public-id');

async function findUserByPublicId(publicId) {
  const rows = await query('SELECT * FROM users WHERE public_id = ? LIMIT 1', [String(publicId || '').trim()]);
  return rows[0] || null;
}

/**
 * 创建新用户，并在同一事务内为其分配默认套餐。
 *
 * 若当前无默认套餐，事务回滚并抛出错误，避免产生"无套餐"的脏数据。
 *
 * @param {object} options
 * @param {string} options.username        用户名（唯一）
 * @param {string} options.passwordHash    bcrypt 密码哈希
 * @param {string|null} [options.email]    邮箱（可选）
 * @param {string|null} [options.phone]    手机号（可选）
 * @param {string} [options.countryType]   'domestic' | 'international'，默认 'domestic'
 * @param {0|1} [options.emailVerified]    邮箱已验证标记，默认 0
 * @param {0|1} [options.phoneVerified]    手机号已验证标记，默认 0
 * @param {string} [options.role]          初始角色，默认 'user'
 * @param {string} [options.status]        初始状态，默认 'active'
 * @returns {Promise<number>} 新用户 ID
 *
 * @throws {Error} 用户名/邮箱/手机号重复（数据库唯一索引冲突）
 * @throws {Error} 'Default plan is not configured'（无默认套餐）
 */
async function createUser({
  username,
  passwordHash,
  email = null,
  phone = null,
  countryType = 'domestic',
  emailVerified = 0,
  phoneVerified = 0,
  role = 'user',
  status = 'active',
}) {
  for (let retry = 0; retry < 5; retry += 1) {
    const publicId = await generateUniqueUserPublicId(async (candidate) => Boolean(await findUserByPublicId(candidate)));

    try {
      return await withTransaction(async (conn) => {
        const [result] = await conn.execute(
          `INSERT INTO users (
            public_id, username, password_hash, email, phone, country_type,
            email_verified, phone_verified, role, status,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [publicId, username, passwordHash, email, phone, countryType, emailVerified, phoneVerified, role, status],
        );

        const userId = result.insertId;

        // 在同一事务内分配默认套餐，保证用户创建后一定有可用的配额
        await assignDefaultPlanToUser(conn, userId);

        return userId;
      });
    } catch (error) {
      if (/public_id|uniq_users_public_id|duplicate/i.test(String(error?.message || '')) && retry < 4) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Unable to allocate unique user ID');
}

/**
 * 按用户名精确查询用户（包含全部字段，用于登录密码验证）。
 *
 * @param {string} username
 * @returns {Promise<object | null>}
 */
async function findUserByUsername(username) {
  const rows = await query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  return rows[0] || null;
}

/**
 * 按邮箱精确查询用户。
 *
 * @param {string} email 小写邮箱
 * @returns {Promise<object | null>}
 */
async function findUserByEmail(email) {
  const rows = await query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  return rows[0] || null;
}

/**
 * 按手机号精确查询用户。
 *
 * @param {string} phone
 * @returns {Promise<object | null>}
 */
async function findUserByPhone(phone) {
  const rows = await query('SELECT * FROM users WHERE phone = ? LIMIT 1', [phone]);
  return rows[0] || null;
}

/**
 * 多字段模糊登录查询：依次匹配 username / email / phone。
 * 用于登录接口，支持用户以任意已绑定字段作为登录账号。
 *
 * @param {string} login 用户输入的登录账号
 * @returns {Promise<object | null>}
 */
async function findUserByLogin(login) {
  const loginLower = String(login || '').toLowerCase();
  const rows = await query(
    'SELECT * FROM users WHERE username = ? OR email = ? OR phone = ? LIMIT 1',
    [login, loginLower, login],
  );
  return rows[0] || null;
}

/**
 * 按 ID 查询用户基础信息（不含密码哈希，用于页面展示）。
 *
 * @param {number} id 用户 ID
 * @returns {Promise<object | null>}
 */
async function findUserById(id) {
  const rows = await query(
    `SELECT
       id, public_id, username, nickname, email, phone, country_type,
       email_verified, phone_verified, role, status, created_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * 按 ID 查询用户认证信息（包含密码哈希，用于资料页改密校验）。
 *
 * @param {number} id 用户 ID
 * @returns {Promise<object | null>}
 */
async function findUserAuthById(id) {
  const rows = await query(
    `SELECT
       id, public_id, username, password_hash, email, phone, role, status, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * 更新用户名。
 *
 * @param {number} userId
 * @param {string} username
 * @returns {Promise<void>}
 */
async function updateUsername(userId, username) {
  await query('UPDATE users SET username = ?, updated_at = NOW() WHERE id = ?', [username, userId]);
}

/**
 * 更新密码哈希。
 *
 * @param {number} userId
 * @param {string} passwordHash
 * @returns {Promise<void>}
 */
async function updatePasswordHash(userId, passwordHash) {
  await query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [passwordHash, userId]);
}

async function updateUserEmail(userId, email, verified = 1) {
  await query('UPDATE users SET email = ?, email_verified = ?, updated_at = NOW() WHERE id = ?', [email, verified ? 1 : 0, userId]);
}

async function unbindUserEmail(userId) {
  await query('UPDATE users SET email = NULL, email_verified = 0, updated_at = NOW() WHERE id = ?', [userId]);
}

async function updateUserPhone(userId, phone, verified = 1) {
  await query('UPDATE users SET phone = ?, phone_verified = ?, updated_at = NOW() WHERE id = ?', [phone, verified ? 1 : 0, userId]);
}

async function unbindUserPhone(userId) {
  await query('UPDATE users SET phone = NULL, phone_verified = 0, updated_at = NOW() WHERE id = ?', [userId]);
}

/**
 * 更新用户角色（仅管理员操作）。
 *
 * @param {number} userId
 * @param {'user' | 'admin'} role
 * @returns {Promise<void>}
 */
async function updateUserRole(userId, role) {
  await query('UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?', [role, userId]);
}

module.exports = {
  createUser,
  findUserByPublicId,
  findUserByUsername,
  findUserByEmail,
  findUserByPhone,
  findUserByLogin,
  findUserById,
  findUserAuthById,
  updateUserRole,
  updateUsername,
  updatePasswordHash,
  updateUserEmail,
  unbindUserEmail,
  updateUserPhone,
  unbindUserPhone,
};
