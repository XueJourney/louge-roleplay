/**
 * @file src/lib/sqlite-schema/users.js
 * @description 用户表结构、public_id 补列与历史用户 public_id 回填。
 */

'use strict';

const crypto = require('node:crypto');

function ensureSqliteColumn(db, tableName, columnName, definitionSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => String(column.name || '').trim() === columnName);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
  }
}


function ensureSqliteUniqueIndex(db, indexName, tableName, columnName, whereSql = '') {
  const indexes = db.prepare(`PRAGMA index_list(${tableName})`).all();
  const hasIndex = indexes.some((index) => String(index.name || '').trim() === indexName);
  if (!hasIndex) {
    db.exec(`CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${columnName}) ${whereSql}`.trim());
  }
}


function getRandomDigitsForSqliteBackfill(length) {
  let value = String(crypto.randomInt(1, 10));
  while (value.length < length) {
    value += String(crypto.randomInt(0, 10));
  }
  return value;
}


function backfillSqliteUserPublicIds(db) {
  const users = db.prepare('SELECT id FROM users WHERE public_id IS NULL OR public_id = ? ORDER BY id ASC').all('');
  if (!users.length) {
    return;
  }

  const exists = (candidate) => {
    const row = db.prepare('SELECT id FROM users WHERE public_id = ? LIMIT 1').get(candidate);
    return Boolean(row);
  };
  const update = db.prepare('UPDATE users SET public_id = ?, updated_at = COALESCE(updated_at, NOW()) WHERE id = ?');

  const digits = 3;
  const maxRandomAttempts = 200;

  for (const user of users) {
    let publicId = '';
    for (let length = digits; !publicId; length += 1) {
      for (let attempt = 0; attempt < maxRandomAttempts; attempt += 1) {
        const candidate = getRandomDigitsForSqliteBackfill(length);
        if (!exists(candidate)) {
          publicId = candidate;
          break;
        }
      }
    }
    update.run(publicId, user.id);
  }
}

function ensureSqliteUsersSchema(db) {
// ─── 用户表 ──────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id    TEXT NULL,
      username     TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      nickname     TEXT NULL,
      email        TEXT NULL,
      phone        TEXT NULL,
      country_type TEXT NOT NULL DEFAULT 'domestic',
      email_verified INTEGER NOT NULL DEFAULT 0,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      role         TEXT NOT NULL DEFAULT 'user',
      status       TEXT NOT NULL DEFAULT 'active',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    )
  `);
  ensureSqliteColumn(db, 'users', 'public_id', 'public_id TEXT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_username ON users (username)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email ON users (email) WHERE email IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_phone ON users (phone) WHERE phone IS NOT NULL');
  backfillSqliteUserPublicIds(db);
  ensureSqliteUniqueIndex(db, 'uniq_users_public_id', 'users', 'public_id', 'WHERE public_id IS NOT NULL');
}

module.exports = { ensureSqliteUsersSchema };
