'use strict';

const { test, assert, assertEqual, assertThrows } = require('./harness');
const mysqlStore = require('../lib/mysqlStore');

test('mysqlStore / formatProbeError maps common codes', () => {
  assertEqual(mysqlStore.formatProbeError({ code: 'ETIMEDOUT' }), '连接超时');
  assertEqual(mysqlStore.formatProbeError({ code: 'ECONNREFUSED' }), '连接被拒绝（主机或端口不可达）');
  assertEqual(mysqlStore.formatProbeError({ code: 'ER_ACCESS_DENIED_ERROR', errno: 1045 }), '账号或密码错误');
  assertEqual(mysqlStore.formatProbeError({ code: 'ER_BAD_DB_ERROR', errno: 1049 }), '数据库不存在');
  assertEqual(mysqlStore.formatProbeError({ message: 'custom' }), 'custom');
});

test('mysqlStore / probe rejects non-mysql type', async () => {
  const result = await mysqlStore.probe({ type: 'postgres', host: '127.0.0.1', database: 'x' });
  assertEqual(result.ok, false);
  assertEqual(result.mode, 'mysql');
  assert(/仅支持 MySQL/.test(result.error));
});

test('mysqlStore / toPoolConfig requires mysql type and database name', () => {
  assertThrows(() => mysqlStore.toPoolConfig(null), /请选择 MySQL 连接/);
  assertThrows(() => mysqlStore.toPoolConfig({ type: 'postgres', database: 'db' }), /仅支持 MySQL/);
  assertThrows(() => mysqlStore.toPoolConfig({ type: 'mysql', database: '' }), /请填写数据库名/);
  const cfg = mysqlStore.toPoolConfig({
    type: 'mysql',
    host: '10.0.0.2',
    port: '3307',
    username: 'root',
    password: 'secret',
    database: 'wje'
  });
  assertEqual(cfg.host, '10.0.0.2');
  assertEqual(cfg.port, 3307);
  assertEqual(cfg.user, 'root');
  assertEqual(cfg.password, 'secret');
  assertEqual(cfg.database, 'wje');
  assertEqual(cfg.charset, 'utf8mb4');
});

test('mysqlStore / isReadOnlySql allows select-like statements', () => {
  assertEqual(mysqlStore.isReadOnlySql('SELECT 1'), true);
  assertEqual(mysqlStore.isReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x'), true);
  assertEqual(mysqlStore.isReadOnlySql('SHOW TABLES'), true);
  assertEqual(mysqlStore.isReadOnlySql('UPDATE user SET x=1'), false);
});

test('mysqlStore / withPreviewLimit appends limit for select without limit', () => {
  const limited = mysqlStore.withPreviewLimit('select * from t order by id desc;', 50);
  assertEqual(limited.sql, 'select * from t order by id desc LIMIT 50');
  assertEqual(limited.limitedAtSql, true);
  assertEqual(limited.limit, 50);
});

test('mysqlStore / withPreviewLimit keeps existing limit', () => {
  const limited = mysqlStore.withPreviewLimit('select * from t limit 10', 50);
  assertEqual(limited.sql, 'select * from t limit 10');
  assertEqual(limited.limitedAtSql, false);
});

test('mysqlStore / executeQuery requires database', async () => {
  let failed = false;
  try {
    await mysqlStore.executeQuery({ type: 'mysql', host: '127.0.0.1', username: 'u', password: 'p' }, 'SELECT 1', {});
  } catch (e) {
    failed = true;
    assert(/请选择数据库/.test(e.message));
  }
  assertEqual(failed, true);
});

test('mysqlStore / default host and port', () => {
  const cfg = mysqlStore.toPoolConfig({ database: 'cap' });
  assertEqual(cfg.host, '127.0.0.1');
  assertEqual(cfg.port, 3306);
  assertEqual(cfg.user, '');
});

test('mysqlStore / create table sql is innodb utf8mb4', () => {
  assert(/CREATE TABLE IF NOT EXISTS `wje_records`/.test(mysqlStore.CREATE_SQL));
  assert(/ENGINE=InnoDB/.test(mysqlStore.CREATE_SQL));
  assert(/utf8mb4/.test(mysqlStore.CREATE_SQL));
  assert(/request_headers/.test(mysqlStore.CREATE_SQL));
  assert(/request_body/.test(mysqlStore.CREATE_SQL));
  assert(/response_headers/.test(mysqlStore.CREATE_SQL));
  assert(/response_body LONGTEXT/.test(mysqlStore.CREATE_SQL));
  assert(/response_body_size/.test(mysqlStore.CREATE_SQL));
  assert(/response_status/.test(mysqlStore.CREATE_SQL));
  assert(/duration_time/.test(mysqlStore.CREATE_SQL));
  assert(!/\bduration\b/.test(mysqlStore.CREATE_SQL.replace(/duration_time/g, '')));
  assert(/captured_time/.test(mysqlStore.CREATE_SQL));
  assert(!/captured_at/.test(mysqlStore.CREATE_SQL));
  assertEqual(mysqlStore.TABLE, 'wje_records');
});

test('mysqlStore / toColumns maps headers body size timing status time', () => {
  const col = mysqlStore.toColumns({
    id: 'a1',
    url: 'https://example.com/x',
    method: 'POST',
    timestamp: 1700000000000,
    requestHeaders: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    requestBody: '{"a":1}',
    responseHeaders: { 'Content-Length': '12' },
    responseBody: 'hello world!',
    responseStatus: 201,
    duration: 45
  });
  assertEqual(col.id, 'a1');
  assertEqual(col.method, 'POST');
  assertEqual(col.timestamp, 1700000000000);
  assertEqual(col.requestBody, '{"a":1}');
  assertEqual(col.responseBody, 'hello world!');
  assert(/Content-Type/.test(col.requestHeaders));
  assert(/Authorization/.test(col.requestHeaders));
  assert(/Content-Length/.test(col.responseHeaders));
  assertEqual(col.responseBodySize, 12);
  assertEqual(col.duration, 45);
  assertEqual(col.responseStatus, '201');
  assertEqual(col.capturedTimeIso, new Date(1700000000000).toISOString());
  assert(col.capturedTime instanceof Date);
  assertEqual(col.capturedTime.getTime(), 1700000000000);
});

test('mysqlStore / toColumns duration from start/end; body size from body bytes', () => {
  const col = mysqlStore.toColumns({
    id: 'b',
    url: 'https://example.com/y',
    method: 'GET',
    timestamp: 1700000001000,
    requestHeaders: {},
    requestBody: '',
    responseHeaders: {},
    responseBody: 'abc',
    reqStartTime: 1000,
    reqEndTime: 1088
  });
  assertEqual(col.duration, 88);
  assertEqual(col.responseBodySize, 3);
  assertEqual(col.responseBody, 'abc');
  assertEqual(col.responseStatus, null);
  assertEqual(col.requestHeaders, '{}');
  const binary = mysqlStore.toColumns({
    id: 'bin',
    url: 'https://example.com/z',
    responseBodyBinary: true,
    responseBody: 'ignored'
  });
  assertEqual(binary.responseBody, '');
});

test('mysqlStore / sqlite backfill fills capture columns from json', () => {
  let DatabaseSync;
  try {
    DatabaseSync = require('node:sqlite').DatabaseSync;
  } catch (e) {
    return;
  }
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE records (id TEXT PRIMARY KEY, json TEXT NOT NULL, request_headers TEXT, ' +
      'request_body TEXT, response_headers TEXT, response_body TEXT, response_body_size INTEGER, duration INTEGER, ' +
      'response_status TEXT, captured_at TEXT)'
  );
  db.prepare('INSERT INTO records (id, json) VALUES (?, ?)').run('x', JSON.stringify({
    id: 'x',
    url: 'https://a.com/x',
    method: 'GET',
    requestHeaders: { A: '1' },
    requestBody: 'q',
    responseHeaders: { 'Content-Length': '4' },
    responseBody: 'abcd',
    responseStatus: 200,
    duration: 9,
    timestamp: 1700000000000
  }));
  mysqlStore.ensureSqliteColumns(db);
  assertEqual(mysqlStore.backfillSqliteColumns(db), 1);
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get('x');
  assertEqual(row.response_status, '200');
  assertEqual(row.duration_time, 9);
  assertEqual(row.response_body_size, 4);
  assertEqual(row.request_body, 'q');
  assertEqual(row.response_body, 'abcd');
  assertEqual(row.captured_time, new Date(1700000000000).toISOString());
  assert(/"A":"1"/.test(row.request_headers) || /"A": "1"/.test(row.request_headers));
  assertEqual(mysqlStore.backfillSqliteColumns(db), 0);
});
