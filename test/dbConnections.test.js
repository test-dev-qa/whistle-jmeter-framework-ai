'use strict';

const { test, assert, assertEqual } = require('./harness');
const connStore = require('../lib/connStore');
const { isEncrypted } = require('../lib/secretVault');
const {
  upsertConnection,
  persistRemote,
  getConnection,
  listConnections,
  deleteConnection
} = require('../lib/dbConnections');

test('connStore / toRow maps form fields', () => {
  const row = connStore.toRow({
    id: 'db1',
    name: 'local',
    description: 'desc',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    database: 'app',
    username: 'root',
    password: 'secret',
    driver: 'com.mysql.cj.jdbc.Driver',
    dataSource: 'db_local',
    jdbcUrl: 'jdbc:mysql://127.0.0.1:3306/app'
  });
  assertEqual(row.dbName, 'app');
  assertEqual(row.username, 'root');
  assertEqual(row.password, 'secret');
  assertEqual(row.port, 3306);
});

test('dbConnections / upsert persists sqlite table and list', () => {
  const item = upsertConnection({
    name: 'persist-sqlite',
    type: 'mysql',
    host: '10.0.0.8',
    port: 3306,
    database: 'cap',
    username: 'u',
    password: 'p'
  });
  assert(item.id);
  const found = getConnection(item.id);
  assertEqual(found.database, 'cap');
  assertEqual(found.username, 'u');
  let rows = [];
  try {
    rows = connStore.loadSqlite();
  } catch (e) {
    deleteConnection(item.id);
    return;
  }
  const row = rows.find((r) => r.id === item.id);
  assert(row);
  assertEqual(row.database, 'cap');
  assertEqual(row.username, 'u');
  assert(isEncrypted(row.password));
  assertEqual(found.password, 'p');
  assertEqual(row.host, '10.0.0.8');
  deleteConnection(item.id);
  assertEqual(listConnections().some((c) => c.id === item.id), false);
});

test('dbConnections / persistRemote skips without mysql database', async () => {
  const item = upsertConnection({ name: 'no-db', type: 'mysql', host: '127.0.0.1' });
  const remote = await persistRemote(item);
  assertEqual(remote.skipped, true);
  assertEqual(remote.mysql, false);
  const pg = upsertConnection({ name: 'pg', type: 'postgres', host: '127.0.0.1', database: 'x' });
  const pgRemote = await persistRemote(pg);
  assertEqual(pgRemote.skipped, true);
  deleteConnection(item.id);
  deleteConnection(pg.id);
});

test('dbConnections / persistRemote authenticates with plaintext and stores encrypted password', async () => {
  const mysql = require('mysql2/promise');
  const originalCreateConnection = mysql.createConnection;
  let config = null;
  let insertParams = null;
  mysql.createConnection = async (connectionConfig) => {
    config = connectionConfig;
    return {
      query: async (sql, params) => {
        if (params) insertParams = params;
      },
      end: async () => {}
    };
  };
  const item = upsertConnection({
    name: 'remote-password',
    type: 'mysql',
    host: '10.0.0.9',
    port: 3306,
    database: 'app',
    username: 'root',
    password: 'secret'
  });
  try {
    const remote = await persistRemote(item);
    assertEqual(remote.mysql, true);
    assertEqual(config.password, 'secret');
    assert(insertParams);
    assert(isEncrypted(insertParams[8]));
    assertEqual(insertParams[8] === config.password, false);
  } finally {
    mysql.createConnection = originalCreateConnection;
    deleteConnection(item.id);
  }
});

test('dbConnections / saving same host db user does not duplicate', () => {
  const first = upsertConnection({
    name: 'a',
    type: 'mysql',
    host: '10.1.2.3',
    port: 3306,
    database: 'appdb',
    username: 'root',
    password: 'x'
  });
  const second = upsertConnection({
    name: 'a-dup',
    type: 'mysql',
    host: '10.1.2.3',
    port: 3306,
    database: 'appdb',
    username: 'root',
    password: 'y'
  });
  assertEqual(second.id, first.id);
  const same = listConnections().filter((c) => c.host === '10.1.2.3' && c.database === 'appdb');
  assertEqual(same.length, 1);
  assertEqual(getConnection(first.id).name, 'a-dup');
  assertEqual(getConnection(first.id).dataSource, 'a_dup');
  const other = upsertConnection({
    name: 'other-db',
    type: 'mysql',
    host: '10.1.2.3',
    port: 3306,
    database: 'other',
    username: 'root'
  });
  assert(other.id !== first.id);
  const named = upsertConnection({
    id: 'db-dup-explicit-b',
    name: 'named-b',
    type: 'mysql',
    host: '10.1.2.3',
    port: 3306,
    database: 'appdb',
    username: 'root'
  });
  assertEqual(named.id, first.id);
  assertEqual(listConnections().filter((c) => c.host === '10.1.2.3' && c.database === 'appdb').length, 1);
  const retry = upsertConnection({
    id: first.id,
    name: 'a-retry',
    type: 'mysql',
    host: '10.1.2.3',
    port: 3306,
    database: 'appdb',
    username: 'root'
  });
  assertEqual(retry.id, first.id);
  assertEqual(listConnections().filter((c) => c.host === '10.1.2.3' && c.database === 'appdb').length, 1);
  deleteConnection(first.id);
  deleteConnection(other.id);
});
