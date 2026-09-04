'use strict';

const { test, assert, assertEqual } = require('./harness');
const mongodbStore = require('../lib/mongodbStore');

test('mongodbStore / builds authenticated URI', () => {
  assertEqual(
    mongodbStore.buildMongoUri({ host: 'db.example.com', port: 27018, username: 'app user', password: 'p@ss', database: 'orders' }),
    'mongodb://app%20user:p%40ss@db.example.com:27018/orders'
  );
});

test('mongodbStore / formats common probe errors', () => {
  assertEqual(mongodbStore.formatProbeError({ code: 18 }), '账号或密码错误');
  assertEqual(mongodbStore.formatProbeError({ name: 'MongoParseError', message: 'bad uri' }), 'MongoDB 连接配置无效');
  assertEqual(mongodbStore.formatProbeError({ name: 'MongoServerSelectionError' }), '连接被拒绝（主机或端口不可达）');
});

test('mongodbStore / probes with MongoClient and defaults database to admin', async () => {
  const Module = require('module');
  const originalLoad = Module._load;
  let commandDatabase = '';
  class FakeMongoClient {
    constructor(uri, options) {
      this.uri = uri;
      this.options = options;
    }

    async connect() {}

    db(name) {
      commandDatabase = name;
      return { command: async () => ({ ok: 1 }) };
    }

    async close() {}
  }
  Module._load = function (request, parent, isMain) {
    if (request === 'mongodb') return { MongoClient: FakeMongoClient };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const result = await mongodbStore.probe({ host: '127.0.0.1', username: 'u', password: 'p' }, 1000);
    assertEqual(result.ok, true);
    assertEqual(result.mode, 'mongodb');
    assertEqual(result.port, 27017);
    assertEqual(commandDatabase, 'admin');
  } finally {
    Module._load = originalLoad;
  }
});
