'use strict';

function createSchemaHelpers(connection) {
  async function ensureColumn(tableName, columnName, definitionSql) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName],
    );
    if (Number(rows[0].count || 0) === 0) {
      await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definitionSql}`);
      console.log(`[init-db]   + 列 ${tableName}.${columnName}`);
    }
  }

  async function ensureIndex(tableName, indexName, columnsSql) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [tableName, indexName],
    );
    if (Number(rows[0].count || 0) === 0) {
      await connection.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` ${columnsSql}`);
      console.log(`[init-db]   + 索引 ${tableName}.${indexName}`);
    }
  }

  async function ensureUniqueIndex(tableName, indexName, columnName) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [tableName, indexName],
    );
    if (Number(rows[0].count || 0) === 0) {
      const columns = Array.isArray(columnName)
        ? columnName
        : String(columnName).split(',').map((item) => item.trim()).filter(Boolean);
      const columnSql = columns.map((column) => `\`${column}\``).join(', ');
      await connection.query(
        `ALTER TABLE \`${tableName}\` ADD UNIQUE INDEX \`${indexName}\` (${columnSql})`,
      );
      console.log(`[init-db]   + 唯一索引 ${tableName}.${indexName}`);
    }
  }

  return { ensureColumn, ensureIndex, ensureUniqueIndex };
}

module.exports = { createSchemaHelpers };
