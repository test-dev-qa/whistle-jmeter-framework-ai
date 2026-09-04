'use strict';

const { test, assertEqual, assertThrows } = require('./harness');
const { executeSql } = require('../lib/dbOps');
const { upsertConnection } = require('../lib/dbConnections');

test('dbOps / executeSql rejects sqlserver', async () => {
  const conn = upsertConnection({
    name: 'mssql-preview',
    type: 'sqlserver',
    host: '127.0.0.1',
    database: 'master'
  });
  try {
    await executeSql({
      connectionId: conn.id,
      sql: 'SELECT 1',
      database: 'master'
    }, {});
    throw new Error('expected throw');
  } catch (e) {
    assertEqual(String(e.message).indexOf('MySQL 与 PostgreSQL') >= 0, true);
  }
});

test('dbOps / executeSql postgres rejects write sql', async () => {
  const conn = upsertConnection({
    name: 'pg-preview',
    type: 'postgres',
    host: '127.0.0.1',
    port: 5432,
    database: 'postgres',
    username: 'u'
  });
  try {
    await executeSql({
      connectionId: conn.id,
      sql: 'DELETE FROM user',
      database: 'postgres'
    }, {});
    throw new Error('expected throw');
  } catch (e) {
    assertEqual(String(e.message).indexOf('查询类 SQL') >= 0, true);
  }
});
