'use strict';

const { test, assertEqual } = require('./harness');
const { setCaptureConfig, getCaptureConfig } = require('../lib/captureConfig');

test('captureConfig / postgres engine keeps postgresConnectionId', () => {
  setCaptureConfig({
    persistEngine: 'postgres',
    postgresConnectionId: 'pg-conn-1',
    mysqlConnectionId: 'should-clear'
  });
  const cfg = getCaptureConfig();
  assertEqual(cfg.persistEngine, 'postgres');
  assertEqual(cfg.postgresConnectionId, 'pg-conn-1');
  assertEqual(cfg.mysqlConnectionId, '');
  setCaptureConfig({ persistEngine: 'sqlite' });
});
