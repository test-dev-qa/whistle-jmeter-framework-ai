'use strict';

const memoryBridge = require('../lib/memoryBridge');

const status = memoryBridge.getStatus();
console.log(JSON.stringify(status, null, 2));
if (!status.available) {
  console.error('\nMemoryBridge 不可用:', status.error || 'unknown');
  process.exit(1);
}
console.log('\nMemoryBridge OK via', status.via || 'unknown');
