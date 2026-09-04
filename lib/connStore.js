'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { toPoolConfig } = require('./mysqlStore');
const { encryptSecret } = require('./secretVault');

const TABLE = 'wje_db_connections';
const DB_FILE = path.join(DATA_DIR, 'dbConnections.sqlite');

const MYSQL_CREATE_SQL = [
  'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (',
  '  id VARCHAR(80) NOT NULL,',
  '  name VARCHAR(80) NOT NULL,',
  '  description VARCHAR(200) NULL,',
  '  type VARCHAR(16) NOT NULL,',
  '  host VARCHAR(200) NULL,',
  '  port INT NULL,',
  '  db_name VARCHAR(120) NULL,',
  '  username VARCHAR(120) NULL,',
  '  password VARCHAR(512) NULL,',
  '  driver VARCHAR(200) NULL,',
  '  data_source VARCHAR(80) NULL,',
  '  jdbc_url VARCHAR(500) NULL,',
  '  updated_at DATETIME(3) NULL,',
  '  PRIMARY KEY (id)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
].join('\n');

const SQLITE_CREATE_SQL = [
  'CREATE TABLE IF NOT EXISTS ' + TABLE + ' (',
  '  id TEXT PRIMARY KEY NOT NULL,',
  '  name TEXT,',
  '  description TEXT,',
  '  type TEXT,',
  '  host TEXT,',
  '  port INTEGER,',
  '  db_name TEXT,',
  '  username TEXT,',
  '  password TEXT,',
  '  driver TEXT,',
  '  data_source TEXT,',
  '  jdbc_url TEXT,',
  '  updated_at TEXT',
  ')'
].join('\n');

let sqlite = null;

function toRow(item) {
  const row = item || {};
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    description: String(row.description || ''),
    type: String(row.type || 'mysql'),
    host: String(row.host || ''),
    port: Number(row.port) > 0 ? Math.trunc(Number(row.port)) : null,
    dbName: String(row.database || ''),
    username: String(row.username || ''),
    password: String(row.password == null ? '' : row.password),
    driver: String(row.driver || ''),
    dataSource: String(row.dataSource || ''),
    jdbcUrl: String(row.jdbcUrl || ''),
    updatedAtIso: new Date().toISOString(),
    updatedAt: new Date()
  };
}

function fromRow(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    host: row.host,
    port: row.port,
    database: row.db_name,
    username: row.username,
    password: row.password,
    driver: row.driver,
    dataSource: row.data_source,
    jdbcUrl: row.jdbc_url
  };
}

function openSqlite() {
  if (sqlite) return sqlite;
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec(SQLITE_CREATE_SQL);
  sqlite = {
    db,
    upsert: db.prepare(
      'INSERT INTO ' + TABLE +
        ' (id, name, description, type, host, port, db_name, username, password, driver, data_source, jdbc_url, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, type=excluded.type, ' +
        'host=excluded.host, port=excluded.port, db_name=excluded.db_name, username=excluded.username, ' +
        'password=excluded.password, driver=excluded.driver, data_source=excluded.data_source, ' +
        'jdbc_url=excluded.jdbc_url, updated_at=excluded.updated_at'
    ),
    remove: db.prepare('DELETE FROM ' + TABLE + ' WHERE id = ?'),
    all: db.prepare('SELECT * FROM ' + TABLE + ' ORDER BY name ASC')
  };
  return sqlite;
}

function upsertSqlite(item) {
  const db = openSqlite();
  const row = toRow(item);
  db.upsert.run(
    row.id,
    row.name,
    row.description,
    row.type,
    row.host,
    row.port,
    row.dbName,
    row.username,
    row.password,
    row.driver,
    row.dataSource,
    row.jdbcUrl,
    row.updatedAtIso
  );
}

function removeSqlite(id) {
  const db = openSqlite();
  db.remove.run(String(id));
}

function loadSqlite() {
  const db = openSqlite();
  return (db.all.all() || []).map(fromRow).filter(Boolean);
}

async function upsertMysql(item) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection(toPoolConfig(item));
  try {
    await conn.query(MYSQL_CREATE_SQL);
    const row = toRow(Object.assign({}, item, { password: encryptSecret(item && item.password) }));
    await conn.query(
      'INSERT INTO `' + TABLE + '` (id, name, description, type, host, port, db_name, username, password, driver, data_source, jdbc_url, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description), type=VALUES(type), ' +
        'host=VALUES(host), port=VALUES(port), db_name=VALUES(db_name), username=VALUES(username), ' +
        'password=VALUES(password), driver=VALUES(driver), data_source=VALUES(data_source), ' +
        'jdbc_url=VALUES(jdbc_url), updated_at=VALUES(updated_at)',
      [
        row.id,
        row.name,
        row.description,
        row.type,
        row.host,
        row.port,
        row.dbName,
        row.username,
        row.password,
        row.driver,
        row.dataSource,
        row.jdbcUrl,
        row.updatedAt
      ]
    );
  } finally {
    await conn.end();
  }
}

async function removeMysql(item) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection(toPoolConfig(item));
  try {
    await conn.query('DELETE FROM `' + TABLE + '` WHERE id = ?', [String(item.id)]);
  } finally {
    await conn.end();
  }
}

module.exports = {
  TABLE,
  MYSQL_CREATE_SQL,
  SQLITE_CREATE_SQL,
  toRow,
  fromRow,
  upsertSqlite,
  removeSqlite,
  loadSqlite,
  upsertMysql,
  removeMysql
};
