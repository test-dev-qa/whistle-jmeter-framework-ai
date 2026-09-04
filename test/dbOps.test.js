'use strict';

const { test, assert, assertEqual } = require('./harness');
const { upsertConnection, jdbcUrl, listConnections, testReachable } = require('../lib/dbConnections');
const {
  setForRecord,
  clearAll,
  toJmeterSql,
  toJmeterJdbc,
  queryType,
  parseResultPath
} = require('../lib/dbOps');
const { generateJMX } = require('../lib/jmxGenerator');

test('dbOps / connection description is kept', () => {
  const conn = upsertConnection({ name: 'with-desc', type: 'mysql', host: '127.0.0.1', description: '测试库' });
  const found = listConnections().find((item) => item.id === conn.id);
  assert(found);
  assertEqual(found.description, '测试库');
});

test('dbOps / testReachable rejects invalid port', async () => {
  const bad = await testReachable('127.0.0.1', 0);
  assertEqual(bad.ok, false);
  assertEqual(bad.error, '端口无效');
});

test('dbOps / resolveTestPayload reuses stored mysql password', () => {
  const { resolveTestPayload, deleteConnection } = require('../lib/dbConnections');
  const conn = upsertConnection({
    name: 'probe-pwd',
    type: 'mysql',
    host: '10.9.8.7',
    port: 3306,
    database: 'app',
    username: 'root',
    password: 'secret-keep'
  });
  const payload = resolveTestPayload({
    id: conn.id,
    type: 'mysql',
    host: '10.9.8.7',
    username: 'root',
    password: '',
    database: 'app'
  });
  assertEqual(payload.password, 'secret-keep');
  assertEqual(payload.type, 'mysql');
  deleteConnection(conn.id);
});

test('dbOps / testConnection postgres falls back to tcp mode', async () => {
  const { testConnection } = require('../lib/dbConnections');
  const result = await testConnection({ type: 'postgres', host: '127.0.0.1', port: 1 }, 200);
  assertEqual(result.mode, 'tcp');
  assertEqual(result.ok, false);
});

test('dbOps / sql placeholders and query type', () => {
  assertEqual(toJmeterSql("SELECT * FROM user WHERE name='{{username}}'"), "SELECT * FROM user WHERE name='${username}'");
  assertEqual(queryType('SELECT id FROM user'), 'Select Statement');
  assertEqual(queryType('WITH x AS (SELECT 1) SELECT * FROM x'), 'Select Statement');
  assertEqual(queryType('UPDATE user SET name=1'), 'Update Statement');
  assertEqual(queryType('CALL do_thing()'), 'Callable Statement');
});

test('dbOps / parseResultPath', () => {
  assertEqual(parseResultPath('$[0].id').column, 'id');
  assertEqual(parseResultPath('$[0].id').index, 0);
  assertEqual(parseResultPath("$[0]['name']").column, 'name');
  assertEqual(parseResultPath('$.token').column, 'token');
});

test('dbOps / save list and dedupe by connection+sql', () => {
  clearAll();
  const conn = upsertConnection({ name: 'local', type: 'mysql', host: '127.0.0.1', database: 'app' });
  const items = setForRecord('db-1', [
    { name: '查用户', connectionId: conn.id, sql: 'SELECT id FROM user', extracts: [{ varName: 'userId', jsonPath: '$[0].id' }] },
    { name: '查用户2', connectionId: conn.id, sql: 'SELECT id FROM user', extracts: [{ varName: 'uid', jsonPath: '$[0].id' }] }
  ]);
  assertEqual(items.length, 1);
  assertEqual(items[0].extracts[0].varName, 'uid');
  clearAll();
});

test('dbOps / jdbc mapping copies first row column', () => {
  const conn = upsertConnection({ name: 'pg', type: 'postgres', host: '10.0.0.2', port: 5432, database: 'demo', username: 'u' });
  const jdbc = toJmeterJdbc({
    name: '查用户',
    connectionId: conn.id,
    sql: "SELECT id FROM user WHERE name='{{username}}'",
    extracts: [{ varName: 'userId', jsonPath: '$[0].id' }]
  });
  assertEqual(jdbc.queryType, 'Select Statement');
  assertEqual(jdbc.sql, "SELECT id FROM user WHERE name='${username}'");
  assertEqual(jdbc.variableNames, 'id');
  assertEqual(jdbc.extracts[0].jmeterSource, 'id_1');
  assertEqual(jdbc.dataSource, 'pg');
  assertEqual(conn.dataSource, 'pg');
  assertEqual(jdbcUrl(conn).indexOf('jdbc:postgresql://10.0.0.2:5432/demo') >= 0, true);
});

test('dbOps / jmx writes JDBCDataSource and JDBCPostProcessor', () => {
  clearAll();
  const conn = upsertConnection({
    name: 'local-mysql',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    database: 'test',
    username: 'root',
    password: 'secret'
  });
  assertEqual(conn.dataSource, 'local_mysql');
  const rec = {
    id: 'db-jmx-1',
    url: 'https://example.com/api',
    method: 'GET',
    requestHeaders: {},
    requestBody: '',
    responseStatus: 200,
    responseBody: '{}'
  };
  setForRecord('db-jmx-1', [{
    name: '查用户',
    connectionId: conn.id,
    sql: "SELECT id, name FROM user WHERE name='{{username}}'",
    extracts: [{ varName: 'userId', jsonPath: '$[0].id' }]
  }]);
  const xml = generateJMX([rec], { correlateToken: false });
  assert(xml.includes('JDBCDataSource'));
  assert(xml.includes('JDBC Connection Configuration - local-mysql'));
  assert(xml.includes('JDBCPostProcessor'));
  assert(xml.includes('JSR223PostProcessor'));
  assert(xml.includes("SELECT id, name FROM user WHERE name='${username}'"));
  assert(xml.includes('jdbc:mysql://127.0.0.1:3306/test'));
  assert(xml.includes('com.mysql.cj.jdbc.Driver'));
  // Configuration 与 PostProcessor 的 Variable Name（dataSource）均取自连接名称
  const poolProps = xml.match(/<stringProp name="dataSource">local_mysql<\/stringProp>/g) || [];
  assertEqual(poolProps.length >= 2, true);
  assert(xml.includes('<stringProp name="username">root</stringProp>'));
  assert(xml.includes('<stringProp name="password">secret</stringProp>'));
  assert(xml.includes('preinit'));
  assert(xml.includes('userId'));
  assert(xml.includes('id_1'));
  assert(xml.includes('查用户'));
  assert(listConnections().length >= 1);
  clearAll();
});

test('dbOps / pool name from connection name including IP-like', () => {
  const conn = upsertConnection({
    name: '192.168.31.6',
    type: 'mysql',
    host: '192.168.31.6',
    database: 'app'
  });
  assertEqual(conn.dataSource, 'db_192_168_31_6');
  const jdbc = toJmeterJdbc({
    name: 'uuu',
    connectionId: conn.id,
    sql: 'SELECT 1',
    extracts: []
  });
  assertEqual(jdbc.dataSource, 'db_192_168_31_6');
});

test('dbOps / resolveSqlVars replaces extract vars', async () => {
  const { resolveSqlVars } = require('../lib/dbOps');
  const { setForRecord: setExtracts } = require('../lib/extractVars');
  upsertConnection({ name: 'sql-vars', type: 'mysql', host: '127.0.0.1', database: 'app' });
  setExtracts('rec-sql', [{
    varName: 'username',
    source: 'json',
    jsonPath: '$.user'
  }]);
  const resolved = await resolveSqlVars(
    "SELECT * FROM user WHERE name='{{username}}'",
    'rec-sql',
    async () => ({
      responseBody: JSON.stringify({ user: 'alice' })
    })
  );
  assertEqual(resolved.sql, "SELECT * FROM user WHERE name='alice'");
  assertEqual(resolved.unresolved.length, 0);
});

test('dbOps / executeSql rejects write statements', async () => {
  const { executeSql } = require('../lib/dbOps');
  const conn = upsertConnection({
    name: 'exec-guard',
    type: 'mysql',
    host: '127.0.0.1',
    database: 'app'
  });
  let failed = false;
  try {
    await executeSql({
      connectionId: conn.id,
      database: 'app',
      sql: 'UPDATE user SET name=1'
    });
  } catch (e) {
    failed = true;
    assert(/仅支持查询类 SQL/.test(e.message));
  }
  assertEqual(failed, true);
});
