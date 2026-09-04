'use strict';

const { test, assert, assertEqual } = require('./harness');
const { setForRecord, listForRecord, clearAll, toJmeterExtractor, resolveItemValue, buildPreviewRecord } = require('../lib/extractVars');
const { correlateTokens } = require('../lib/tokenCorrelate');
const { generateJMX } = require('../lib/jmxGenerator');

test('extractVars / save list and json extractor', () => {
  clearAll();
  const items = setForRecord('rec-1', [{
    varName: 'dataSourceUrl',
    source: 'json',
    jsonPath: '$.data.returnInfo.dataSourceUrl'
  }]);
  assertEqual(items.length, 1);
  assertEqual(listForRecord('rec-1')[0].varName, 'dataSourceUrl');
  const extractor = toJmeterExtractor(items[0]);
  assertEqual(extractor.type, 'json');
  assertEqual(extractor.jsonPath, '$.data.returnInfo.dataSourceUrl');
  clearAll();
});

test('extractVars / preview json path and correlate substitutes later request', () => {
  clearAll();
  const login = {
    id: 'login-1',
    url: 'https://example.com/status',
    method: 'POST',
    requestHeaders: {},
    requestBody: '{}',
    responseHeaders: { 'X-Trace': 'trace-abc' },
    responseBody: JSON.stringify({ data: { returnInfo: { dataSourceUrl: 'https://cdn.example/file' } } })
  };
  const next = {
    id: 'next-1',
    url: 'https://example.com/download?src=https://cdn.example/file',
    method: 'GET',
    requestHeaders: {},
    requestBody: '',
    responseBody: '{}'
  };
  const preview = resolveItemValue(login, {
    source: 'json',
    method: 'jsonpath',
    jsonPath: '$.data.returnInfo.dataSourceUrl',
    varName: 'dataSourceUrl'
  });
  assert(preview.ok);
  assertEqual(preview.preview, 'https://cdn.example/file');

  const fromBody = buildPreviewRecord(null, {
    responseBody: JSON.stringify({ data: { id: 4839 } })
  });
  const idPreview = resolveItemValue(fromBody, {
    source: 'json',
    method: 'jsonpath',
    jsonPath: '$.data.id',
    varName: 'id'
  });
  assert(idPreview.ok);
  assertEqual(idPreview.preview, '4839');
  const lite = buildPreviewRecord({ responseBody: '', _bodiesOffloaded: true }, {
    responseBody: JSON.stringify({ data: { id: 4839 } })
  });
  assertEqual(resolveItemValue(lite, { source: 'json', jsonPath: '$.data.id' }).preview, '4839');

  setForRecord('login-1', [{
    varName: 'dataSourceUrl',
    source: 'json',
    jsonPath: '$.data.returnInfo.dataSourceUrl'
  }]);
  const plans = correlateTokens([login, next], {
    autoCorrelate: false,
    manualExtractors: [[{
      varName: 'dataSourceUrl',
      source: 'json',
      jsonPath: '$.data.returnInfo.dataSourceUrl'
    }], []]
  });
  assert(plans[0].extractors.some((item) => item.varName === 'dataSourceUrl' && item.jsonPath.includes('dataSourceUrl')));
  assert(plans[1].path.includes('${dataSourceUrl}'));
  clearAll();
});

test('extractVars / jmx writes JSONPostProcessor even when auto correlate off', () => {
  clearAll();
  const rec = {
    id: 'jmx-ext-1',
    url: 'https://example.com/api',
    method: 'GET',
    requestHeaders: {},
    requestBody: '',
    responseStatus: 200,
    responseBody: JSON.stringify({ data: { id: 'ORD-1' } })
  };
  setForRecord('jmx-ext-1', [{
    varName: 'orderId',
    source: 'json',
    jsonPath: '$.data.id'
  }]);
  const xml = generateJMX([rec], { correlateToken: false });
  assert(xml.includes('JSONPostProcessor'));
  assert(xml.includes('$.data.id'));
  assert(xml.includes('orderId'));
  clearAll();
});

test('extractVars / setForRecord dedupes same name and same path', () => {
  clearAll();
  const items = setForRecord('rec-dup', [
    { varName: 'createBy', source: 'json', jsonPath: '$.data.browsingList[0].ecDataPool.createBy' },
    { varName: 'createBy', source: 'json', jsonPath: '$.data.browsingList[0].ecDataPool.createBy' },
    { varName: 'createBy', source: 'json', jsonPath: '$.data.browsingList[0].ecDataPool.createBy' }
  ]);
  assertEqual(items.length, 1);
  assertEqual(items[0].varName, 'createBy');
  const mixed = setForRecord('rec-dup', items.concat([{
    varName: 'otherName',
    source: 'json',
    jsonPath: '$.data.browsingList[0].ecDataPool.createBy'
  }]));
  assertEqual(mixed.length, 1);
  assertEqual(mixed[0].varName, 'otherName');
  clearAll();
});
