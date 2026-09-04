'use strict';

const { test, assert } = require('./harness');
const plugin = require('../index');

test('index / exports uiServer and resStatsServer functions', () => {
  assert(typeof plugin.uiServer === 'function', 'uiServer must be a function');
  assert(typeof plugin.resStatsServer === 'function', 'resStatsServer must be a function');
  assert(typeof plugin.wsReqRead === 'function', 'wsReqRead must be a function');
  assert(typeof plugin.wsResRead === 'function', 'wsResRead must be a function');
  assert(typeof plugin !== 'function', 'default export must not be pluginServer');
});
