'use strict';

const { test, assert, assertEqual } = require('./harness');
const postOpStore = require('../lib/postOpStore');
const {
  setForRecord: setExtract,
  listForRecord: listExtract,
  clearAll: clearExtract
} = require('../lib/extractVars');
const {
  setForRecord: setAssert,
  listForRecord: listAssert,
  clearAll: clearAssert
} = require('../lib/assertions');
const {
  setForRecord: setDbOp,
  listForRecord: listDbOp,
  clearAll: clearDbOp
} = require('../lib/dbOps');

test('postOpStore / extract vars land in sqlite columns', () => {
  clearExtract();
  const items = setExtract('rec-post-1', [{
    varName: 'dataSourceUrl',
    source: 'json',
    jsonPath: '$.data.url',
    arrayUnpack: true
  }]);
  assertEqual(items.length, 1);
  assertEqual(listExtract('rec-post-1')[0].jsonPath, '$.data.url');
  const mapped = postOpStore.loadKind('extract');
  assertEqual(mapped['rec-post-1'].length, 1);
  assertEqual(mapped['rec-post-1'][0].varName, 'dataSourceUrl');
  assertEqual(mapped['rec-post-1'][0].arrayUnpack, true);
  clearExtract();
  assertEqual((postOpStore.loadKind('extract')['rec-post-1'] || []).length, 0);
});

test('postOpStore / assertions land in sqlite columns', () => {
  clearAssert();
  setAssert('rec-post-2', [{
    name: 'code ok',
    source: 'json',
    jsonPath: '$.code',
    operator: 'equals',
    expected: '200'
  }]);
  const mapped = postOpStore.loadKind('assert');
  assertEqual(mapped['rec-post-2'].length, 1);
  assertEqual(mapped['rec-post-2'][0].expected, '200');
  assertEqual(mapped['rec-post-2'][0].operator, 'equals');
  assertEqual(listAssert('rec-post-2')[0].name, 'code ok');
  clearAssert();
});

test('postOpStore / db ops and extracts land in sqlite tables', () => {
  clearDbOp();
  setDbOp('rec-post-3', [{
    name: '查用户',
    connectionId: 'db1',
    sql: 'SELECT id FROM user',
    extracts: [{ varName: 'userId', jsonPath: '$[0].id' }]
  }]);
  const mapped = postOpStore.loadKind('dbop');
  assertEqual(mapped['rec-post-3'].length, 1);
  assertEqual(mapped['rec-post-3'][0].sql, 'SELECT id FROM user');
  assertEqual(mapped['rec-post-3'][0].extracts.length, 1);
  assertEqual(mapped['rec-post-3'][0].extracts[0].varName, 'userId');
  assertEqual(listDbOp('rec-post-3')[0].connectionId, 'db1');
  clearDbOp();
});

test('postOpStore / mysql ddl creates post-op tables', () => {
  const { MYSQL_DDL } = require('../lib/postOpStore');
  assertEqual(MYSQL_DDL.length, 4);
  assert(/CREATE TABLE IF NOT EXISTS `wje_extract_vars`/.test(MYSQL_DDL[0]));
  assert(/CREATE TABLE IF NOT EXISTS `wje_assertions`/.test(MYSQL_DDL[1]));
  assert(/CREATE TABLE IF NOT EXISTS `wje_db_ops`/.test(MYSQL_DDL[2]));
  assert(/sql_text/.test(MYSQL_DDL[2]));
  assert(!/\n\s+sql TEXT/.test(MYSQL_DDL[2]));
  assert(/CREATE TABLE IF NOT EXISTS `wje_db_op_extracts`/.test(MYSQL_DDL[3]));
});

test('postOpStore / writeKind sync helper exports ensureMysqlSchema', () => {
  const store = require('../lib/postOpStore');
  assert(typeof store.ensureMysqlSchema === 'function');
  assert(typeof store.flushMysql === 'function');
  assertEqual(typeof store.loadKind, 'function');
  const extracts = store.loadKind('extract');
  assert(extracts && typeof extracts === 'object');
});
