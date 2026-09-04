const { create } = require('xmlbuilder2');
const { normalizeHeaders, sanitizeXmlText, isMultipart, getContentType } = require('./utils');
const { correlateTokens } = require('./tokenCorrelate');
const { getExtractorsForRecords } = require('./extractVars');
const { getAssertionsForRecords, toJmeterAssertion } = require('./assertions');
const { getDbOpsForRecords, collectUsedConnections, toJmeterJdbc } = require('./dbOps');
const { jdbcPoolName } = require('./dbConnections');
const { toUploadVarPath, uploadRootPosix } = require('./multipart');

const SKIP_HEADERS = new Set([
  'content-length',
  'host',
  'connection',
  'accept-encoding',
  'transfer-encoding',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
  'expect',
  'cookie'
]);

function getRequestBody(record) {
  if (record.requestBodyBinary) return '';
  if (isMultipart(record.requestHeaders || record.headers)) return '';
  if (record.requestBody != null && record.requestBody !== '') {
    return record.requestBody;
  }
  return record.body || '';
}

function getRequestHeaders(record) {
  return normalizeHeaders(record.requestHeaders || record.headers || {});
}

function addUserVar(collection, name, value) {
  const el = collection.ele('elementProp', { name, elementType: 'Argument' });
  addString(el, 'Argument.name', name);
  addString(el, 'Argument.value', sanitizeXmlText(value));
  addString(el, 'Argument.metadata', '=');
}

function hasUploadFiles(record) {
  return Boolean(record && record.multipart && record.multipart.files && record.multipart.files.length);
}

function addBool(parent, name, value) {
  parent.ele('boolProp', { name }).txt(String(Boolean(value)));
}

function addString(parent, name, value) {
  const node = parent.ele('stringProp', { name });
  if (value != null && value !== '') node.txt(String(value));
}

function addInt(parent, name, value) {
  parent.ele('intProp', { name }).txt(String(value));
}

function addHttpDefaults(parent, endpoint) {
  const el = parent.ele('ConfigTestElement', {
    guiclass: 'HttpDefaultsGui',
    testclass: 'ConfigTestElement',
    testname: 'HTTP Request Defaults',
    enabled: 'true'
  });
  el.ele('elementProp', {
    name: 'HTTPsampler.Arguments',
    elementType: 'Arguments',
    guiclass: 'HTTPArgumentsPanel',
    testclass: 'Arguments',
    testname: 'User Defined Variables',
    enabled: 'true'
  }).ele('collectionProp', { name: 'Arguments.arguments' });
  addString(el, 'HTTPSampler.domain', sanitizeXmlText(endpoint.domain));
  addString(el, 'HTTPSampler.port', String(endpoint.port));
  addString(el, 'HTTPSampler.protocol', endpoint.protocol);
  addString(el, 'HTTPSampler.contentEncoding', 'UTF-8');
  addString(el, 'HTTPSampler.path', '');
  addBool(el, 'HTTPSampler.follow_redirects', true);
  addBool(el, 'HTTPSampler.auto_redirects', false);
  addBool(el, 'HTTPSampler.use_keepalive', true);
  addBool(el, 'HTTPSampler.DO_MULTIPART_POST', false);
  addString(el, 'HTTPSampler.embedded_url_re', '');
  addString(el, 'HTTPSampler.connect_timeout', '');
  addString(el, 'HTTPSampler.response_timeout', '');
  parent.ele('hashTree');
}

function sharedEndpoint(valid) {
  if (!valid.length) return null;
  const first = valid[0];
  const key = `${first.protocol}|${first.domain}|${first.port}`;
  if (!valid.every((item) => `${item.protocol}|${item.domain}|${item.port}` === key)) {
    return null;
  }
  return { protocol: first.protocol, domain: first.domain, port: first.port };
}

function addCookieManager(parent) {
  const mgr = parent.ele('CookieManager', {
    guiclass: 'CookiePanel',
    testclass: 'CookieManager',
    testname: 'HTTP Cookie Manager',
    enabled: 'true'
  });
  mgr.ele('collectionProp', { name: 'CookieManager.cookies' });
  addBool(mgr, 'CookieManager.clearEachIteration', false);
  addBool(mgr, 'CookieManager.controlledByThreadGroup', false);
  parent.ele('hashTree');
}

function addViewResultsTree(parent) {
  const collector = parent.ele('ResultCollector', {
    guiclass: 'ViewResultsFullVisualizer',
    testclass: 'ResultCollector',
    testname: 'View Results Tree',
    enabled: 'true'
  });
  addBool(collector, 'ResultCollector.error_logging', false);
  const value = collector.ele('objProp').ele('name').txt('saveConfig').up()
    .ele('value', { class: 'SampleSaveConfiguration' });
  [
    ['time', 'true'],
    ['latency', 'true'],
    ['timestamp', 'true'],
    ['success', 'true'],
    ['label', 'true'],
    ['code', 'true'],
    ['message', 'true'],
    ['threadName', 'true'],
    ['dataType', 'true'],
    ['encoding', 'false'],
    ['assertions', 'true'],
    ['subresults', 'true'],
    ['responseData', 'false'],
    ['samplerData', 'false'],
    ['xml', 'false'],
    ['fieldNames', 'true'],
    ['responseHeaders', 'false'],
    ['requestHeaders', 'false'],
    ['responseDataOnError', 'false'],
    ['saveAssertionResultsFailureMessage', 'true'],
    ['assertionsResultsToSave', '0'],
    ['bytes', 'true'],
    ['sentBytes', 'true'],
    ['url', 'true'],
    ['threadCounts', 'true'],
    ['idleTime', 'true'],
    ['connectTime', 'true']
  ].forEach(([tag, text]) => {
    value.ele(tag).txt(text);
  });
  addString(collector, 'filename', '');
  parent.ele('hashTree');
}

function addJsonPathAssertion(parent, item) {
  const node = parent.ele('JSONPathAssertion', {
    guiclass: 'JSONPathAssertionGui',
    testclass: 'JSONPathAssertion',
    testname: sanitizeXmlText(item.name || 'JSON Assertion'),
    enabled: 'true'
  });
  addString(node, 'JSON_PATH', item.jsonPath || '$');
  addString(node, 'EXPECTED_VALUE', item.expected || '');
  addBool(node, 'JSONVALIDATION', item.validate !== false);
  addBool(node, 'EXPECT_NULL', false);
  addBool(node, 'INVERT', Boolean(item.invert));
  addBool(node, 'ISREGEX', Boolean(item.isRegex));
  parent.ele('hashTree');
}

function addConfiguredResponseAssertion(parent, item) {
  const assertion = parent.ele('ResponseAssertion', {
    guiclass: 'AssertionGui',
    testclass: 'ResponseAssertion',
    testname: sanitizeXmlText(item.name || 'Response Assertion'),
    enabled: 'true'
  });
  assertion.ele('collectionProp', { name: 'Asserion.test_strings' })
    .ele('stringProp', { name: String(item.testString || '') }).txt(String(item.testString || ''));
  addString(assertion, 'Assertion.custom_message', '');
  addString(assertion, 'Assertion.test_field', item.field || 'Assertion.response_data');
  addBool(assertion, 'Assertion.assume_success', false);
  addInt(assertion, 'Assertion.test_type', item.testType == null ? 8 : Number(item.testType));
  parent.ele('hashTree');
}

function addConfiguredAssertion(parent, raw) {
  const item = toJmeterAssertion(raw);
  if (item.kind === 'jsonpath') {
    addJsonPathAssertion(parent, item);
    return;
  }
  addConfiguredResponseAssertion(parent, item);
}

function addResponseAssertion(parent, statusCode) {
  const assertion = parent.ele('ResponseAssertion', {
    guiclass: 'AssertionGui',
    testclass: 'ResponseAssertion',
    testname: `Assert ${statusCode}`,
    enabled: 'true'
  });
  assertion.ele('collectionProp', { name: 'Asserion.test_strings' })
    .ele('stringProp', { name: String(statusCode) }).txt(String(statusCode));
  addString(assertion, 'Assertion.custom_message', '');
  addString(assertion, 'Assertion.test_field', 'Assertion.response_code');
  addBool(assertion, 'Assertion.assume_success', false);
  addInt(assertion, 'Assertion.test_type', 8);
  parent.ele('hashTree');
}

function samplerName(method, pathname, index) {
  const pathLabel = pathname && pathname !== '/' ? pathname : '/';
  const raw = `${method} ${pathLabel}`;
  const trimmed = raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
  return sanitizeXmlText(`${index}. ${trimmed}`);
}

function addFormArguments(collectionProp, body) {
  const params = new URLSearchParams(body);
  for (const [name, value] of params.entries()) {
    const argProp = collectionProp.ele('elementProp', {
      name: sanitizeXmlText(name),
      elementType: 'HTTPArgument'
    });
    addBool(argProp, 'HTTPArgument.always_encode', !String(value).includes('${'));
    addBool(argProp, 'HTTPArgument.use_equals', true);
    addString(argProp, 'Argument.name', sanitizeXmlText(name));
    addString(argProp, 'Argument.value', sanitizeXmlText(value));
    addString(argProp, 'Argument.metadata', '=');
  }
}

function addMultipart(sampler, collectionProp, multipart) {
  (multipart.fields || []).forEach((field) => {
    const argProp = collectionProp.ele('elementProp', {
      name: sanitizeXmlText(field.name || ''),
      elementType: 'HTTPArgument'
    });
    addBool(argProp, 'HTTPArgument.always_encode', !String(field.value || '').includes('${'));
    addBool(argProp, 'HTTPArgument.use_equals', true);
    addString(argProp, 'Argument.name', sanitizeXmlText(field.name || ''));
    addString(argProp, 'Argument.value', sanitizeXmlText(field.value || ''));
    addString(argProp, 'Argument.metadata', '=');
  });
  const files = multipart.files || [];
  if (files.length) {
    const fileCollection = sampler
      .ele('elementProp', { name: 'HTTPsampler.Files', elementType: 'HTTPFileArgs' })
      .ele('collectionProp', { name: 'HTTPFileArgs.files' });
    files.forEach((file) => {
      const filePath = toUploadVarPath(file.path || '');
      const el = fileCollection.ele('elementProp', { name: filePath, elementType: 'HTTPFileArg' });
      addString(el, 'File.path', sanitizeXmlText(filePath));
      addString(el, 'File.paramname', sanitizeXmlText(file.name || 'file'));
      addString(el, 'File.mimetype', sanitizeXmlText(file.mimeType || 'application/octet-stream'));
    });
  }
  addBool(sampler, 'HTTPSampler.DO_MULTIPART_POST', true);
  addBool(sampler, 'HTTPSampler.BROWSER_COMPATIBLE_MULTIPART', true);
}

function addRawBody(sampler, collectionProp, body) {
  const argProp = collectionProp.ele('elementProp', { name: '', elementType: 'HTTPArgument' });
  addBool(argProp, 'HTTPArgument.always_encode', false);
  addString(argProp, 'Argument.value', sanitizeXmlText(body));
  addString(argProp, 'Argument.metadata', '=');
  addBool(sampler, 'HTTPSampler.postBodyRaw', true);
}

function addRegexExtractor(parent, extractor) {
  const node = parent.ele('RegexExtractor', {
    guiclass: 'RegexExtractorGui',
    testclass: 'RegexExtractor',
    testname: `Extract ${extractor.varName}`,
    enabled: 'true'
  });
  addString(node, 'RegexExtractor.useHeaders', extractor.useHeaders ? 'true' : 'false');
  addString(node, 'RegexExtractor.refname', extractor.varName);
  addString(node, 'RegexExtractor.regex', extractor.regex);
  addString(node, 'RegexExtractor.template', '$1$');
  addString(node, 'RegexExtractor.default', 'NOT_FOUND');
  addString(node, 'RegexExtractor.match_number', '1');
  parent.ele('hashTree');
}

function addExtractor(parent, extractor) {
  if (extractor.type === 'regex' && extractor.regex) {
    addRegexExtractor(parent, extractor);
    return;
  }
  if (extractor.jsonPath) {
    addJsonExtractor(parent, extractor);
  }
}

function addJdbcDataSource(parent, conn) {
  const label = conn && conn.name
    ? `JDBC Connection Configuration - ${conn.name}`
    : 'JDBC Connection Configuration';
  const node = parent.ele('JDBCDataSource', {
    guiclass: 'TestBeanGUI',
    testclass: 'JDBCDataSource',
    testname: sanitizeXmlText(label),
    enabled: 'true'
  });
  addBool(node, 'autocommit', true);
  addString(node, 'checkQuery', '');
  addString(node, 'connectionAge', '5000');
  addString(node, 'dataSource', jdbcPoolName(conn));
  addString(node, 'dbUrl', conn.jdbcUrl || '');
  addString(node, 'driver', conn.driver || 'com.mysql.cj.jdbc.Driver');
  addBool(node, 'keepAlive', true);
  addString(node, 'password', conn.password || '');
  addString(node, 'poolMax', '10');
  addBool(node, 'preinit', false);
  addString(node, 'timeout', '10000');
  addString(node, 'transactionIsolation', 'DEFAULT');
  addString(node, 'trimInterval', '60000');
  addString(node, 'username', conn.username || '');
  parent.ele('hashTree');
}

function addJdbcPostProcessor(parent, item) {
  const jdbc = toJmeterJdbc(item);
  const node = parent.ele('JDBCPostProcessor', {
    guiclass: 'TestBeanGUI',
    testclass: 'JDBCPostProcessor',
    testname: sanitizeXmlText(jdbc.name || 'JDBC PostProcessor'),
    enabled: 'true'
  });
  addString(node, 'dataSource', jdbc.dataSource);
  addString(node, 'query', jdbc.sql);
  addString(node, 'queryArguments', '');
  addString(node, 'queryArgumentsTypes', '');
  addString(node, 'queryTimeout', '');
  addString(node, 'queryType', jdbc.queryType);
  addString(node, 'resultSetHandler', 'Store as String');
  addString(node, 'resultVariable', jdbc.resultVariable || '');
  addString(node, 'variableNames', jdbc.variableNames || '');
  parent.ele('hashTree');

  const copies = (jdbc.extracts || []).filter((row) => row.varName && row.jmeterSource && row.varName !== row.jmeterSource);
  if (!copies.length) return;
  const script = copies
    .map((row) => `if (vars.get(${JSON.stringify(row.jmeterSource)}) != null) vars.put(${JSON.stringify(row.varName)}, vars.get(${JSON.stringify(row.jmeterSource)}));`)
    .join('\n');
  const jsr = parent.ele('JSR223PostProcessor', {
    guiclass: 'TestBeanGUI',
    testclass: 'JSR223PostProcessor',
    testname: sanitizeXmlText(`Copy ${jdbc.name || 'JDBC'} vars`),
    enabled: 'true'
  });
  addString(jsr, 'cacheKey', 'true');
  addString(jsr, 'filename', '');
  addString(jsr, 'parameters', '');
  addString(jsr, 'script', script);
  addString(jsr, 'scriptLanguage', 'groovy');
  parent.ele('hashTree');
}

function addJsonExtractor(parent, extractor) {
  const node = parent.ele('JSONPostProcessor', {
    guiclass: 'JSONPostProcessorGui',
    testclass: 'JSONPostProcessor',
    testname: `Extract ${extractor.varName}`,
    enabled: 'true'
  });
  addString(node, 'JSONPostProcessor.referenceNames', extractor.varName);
  addString(node, 'JSONPostProcessor.jsonPathExprs', extractor.jsonPath);
  addString(node, 'JSONPostProcessor.match_numbers', extractor.matchNumbers != null ? String(extractor.matchNumbers) : '1');
  addString(node, 'JSONPostProcessor.defaultValues', 'NOT_FOUND');
  addBool(node, 'JSONPostProcessor.compute_concat', false);
  parent.ele('hashTree');
}

function collectValidRecords(records) {
  const valid = [];
  let skipped = 0;
  records.forEach((record) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(record.url);
    } catch (e) {
      skipped += 1;
      return;
    }
    const protocol = parsedUrl.protocol.replace(':', '').toLowerCase();
    if (protocol !== 'http' && protocol !== 'https') {
      skipped += 1;
      return;
    }
    valid.push({
      record,
      parsedUrl,
      protocol,
      domain: parsedUrl.hostname,
      port: parsedUrl.port || (protocol === 'https' ? '443' : '80'),
      method: record.method ? String(record.method).toUpperCase() : 'GET'
    });
  });
  return { valid, skipped };
}

function buildPlans(valid, options) {
  const manuals = getExtractorsForRecords(valid.map((item) => item.record && item.record.id));
  const correlateToken = options && options.correlateToken;
  return correlateTokens(valid.map((item) => item.record), {
    edits: options && options.correlateEdits,
    manualExtractors: manuals,
    autoCorrelate: correlateToken !== false
  });
}

function generateJMX(records, options = {}) {
  if (!records || records.length === 0) {
    throw new Error('No records provided to generate JMX');
  }

  const threads = options.threads || 1;
  const loops = options.loops || 1;
  const rampTime = options.rampTime == null ? 1 : options.rampTime;
  const { valid, skipped } = collectValidRecords(records);
  const needsUploadDir = valid.some((item) => hasUploadFiles(item.record));

  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const rootHashTree = doc
    .ele('jmeterTestPlan', { version: '1.2', properties: '5.0', jmeter: '5.5' })
    .ele('hashTree');

  const testPlan = rootHashTree.ele('TestPlan', {
    guiclass: 'TestPlanGui',
    testclass: 'TestPlan',
    testname: 'Whistle Generated Test Plan',
    enabled: 'true'
  });
  addString(testPlan, 'TestPlan.comments', needsUploadDir
    ? 'Generated by Whistle Plugin. Change uploadDir if you move data/uploads.'
    : 'Generated by Whistle Plugin');
  addBool(testPlan, 'TestPlan.functional_mode', false);
  addBool(testPlan, 'TestPlan.tearDown_on_shutdown', true);
  addBool(testPlan, 'TestPlan.serialize_threadgroups', false);
  const udv = testPlan
    .ele('elementProp', {
      name: 'TestPlan.user_defined_variables',
      elementType: 'Arguments',
      guiclass: 'ArgumentsPanel',
      testclass: 'Arguments',
      testname: 'User Defined Variables',
      enabled: 'true'
    })
    .ele('collectionProp', { name: 'Arguments.arguments' });
  if (needsUploadDir) {
    addUserVar(udv, 'uploadDir', uploadRootPosix());
  }
  addString(testPlan, 'TestPlan.user_define_classpath', '');

  const threadGroupParent = rootHashTree.ele('hashTree');
  const threadGroup = threadGroupParent.ele('ThreadGroup', {
    guiclass: 'ThreadGroupGui',
    testclass: 'ThreadGroup',
    testname: 'Thread Group',
    enabled: 'true'
  });
  addString(threadGroup, 'ThreadGroup.on_sample_error', 'continue');
  const loopController = threadGroup.ele('elementProp', {
    name: 'ThreadGroup.main_controller',
    elementType: 'LoopController',
    guiclass: 'LoopControlPanel',
    testclass: 'LoopController',
    testname: 'Loop Controller',
    enabled: 'true'
  });
  addBool(loopController, 'LoopController.continue_forever', false);
  addString(loopController, 'LoopController.loops', String(loops));
  addString(threadGroup, 'ThreadGroup.num_threads', String(threads));
  addString(threadGroup, 'ThreadGroup.ramp_time', String(rampTime));
  addBool(threadGroup, 'ThreadGroup.scheduler', false);
  addString(threadGroup, 'ThreadGroup.duration', '');
  addString(threadGroup, 'ThreadGroup.delay', '');
  addBool(threadGroup, 'ThreadGroup.same_user_on_next_iteration', true);

  const samplersHashTree = threadGroupParent.ele('hashTree');
  addCookieManager(samplersHashTree);

  const defaults = sharedEndpoint(valid);
  if (defaults) {
    addHttpDefaults(samplersHashTree, defaults);
  }
  const recordIds = valid.map((item) => item.record && item.record.id);
  collectUsedConnections(recordIds).forEach((conn) => addJdbcDataSource(samplersHashTree, conn));
  const plans = buildPlans(valid, options);
  const userAsserts = getAssertionsForRecords(recordIds);
  const userDbOps = getDbOpsForRecords(recordIds);
  let added = 0;

  valid.forEach((item, index) => {
    const plan = plans[index];
    const record = item.record;
    const method = item.method;
    const headers = plan.headers || getRequestHeaders(record);
    const multipart = plan.multipart || record.multipart;
    const hasMultipart = Boolean(
      multipart && ((multipart.files && multipart.files.length) || (multipart.fields && multipart.fields.length))
    );
    const requestBody = record.requestBodyBinary || hasMultipart
      ? ''
      : (plan.body != null ? plan.body : getRequestBody(record));
    const path = plan.path || ((item.parsedUrl.pathname || '/') + item.parsedUrl.search);
    const pathnameForName = path.split('?')[0] || '/';

    const sampler = samplersHashTree.ele('HTTPSamplerProxy', {
      guiclass: 'HttpTestSampleGui',
      testclass: 'HTTPSamplerProxy',
      testname: samplerName(method, pathnameForName, added + 1),
      enabled: 'true'
    });

    const collectionProp = sampler
      .ele('elementProp', {
        name: 'HTTPsampler.Arguments',
        elementType: 'Arguments',
        guiclass: 'HTTPArgumentsPanel',
        testclass: 'Arguments',
        testname: 'User Defined Variables',
        enabled: 'true'
      })
      .ele('collectionProp', { name: 'Arguments.arguments' });

    if (hasMultipart) {
      addMultipart(sampler, collectionProp, multipart);
    } else if (requestBody) {
      if (getContentType(headers).includes('application/x-www-form-urlencoded')) {
        addFormArguments(collectionProp, requestBody);
      } else {
        addRawBody(sampler, collectionProp, requestBody);
      }
    }

    addString(sampler, 'HTTPSampler.domain', defaults ? '' : sanitizeXmlText(item.domain));
    addString(sampler, 'HTTPSampler.port', defaults ? '' : String(item.port));
    addString(sampler, 'HTTPSampler.protocol', defaults ? '' : item.protocol);
    addString(sampler, 'HTTPSampler.contentEncoding', 'UTF-8');
    addString(sampler, 'HTTPSampler.path', sanitizeXmlText(path));
    addString(sampler, 'HTTPSampler.method', method);
    addBool(sampler, 'HTTPSampler.follow_redirects', true);
    addBool(sampler, 'HTTPSampler.auto_redirects', false);
    addBool(sampler, 'HTTPSampler.use_keepalive', true);
    if (!hasMultipart) {
      addBool(sampler, 'HTTPSampler.DO_MULTIPART_POST', false);
    }
    addString(sampler, 'HTTPSampler.embedded_url_re', '');
    addString(sampler, 'HTTPSampler.connect_timeout', '');
    addString(sampler, 'HTTPSampler.response_timeout', '');

    const samplerChildren = samplersHashTree.ele('hashTree');
    const headerEntries = [];
    for (const [key, value] of Object.entries(headers)) {
      if (!key || SKIP_HEADERS.has(key.toLowerCase())) continue;
      if (hasMultipart && key.toLowerCase() === 'content-type') continue;
      headerEntries.push([key, value]);
    }
    if (headerEntries.length) {
      const headerCollection = samplerChildren
        .ele('HeaderManager', {
          guiclass: 'HeaderPanel',
          testclass: 'HeaderManager',
          testname: 'HTTP Header Manager',
          enabled: 'true'
        })
        .ele('collectionProp', { name: 'HeaderManager.headers' });
      headerEntries.forEach(([key, value]) => {
        const headerProp = headerCollection.ele('elementProp', { name: '', elementType: 'Header' });
        addString(headerProp, 'Header.name', sanitizeXmlText(key));
        addString(headerProp, 'Header.value', sanitizeXmlText(value));
      });
      samplerChildren.ele('hashTree');
    }

    (plan.extractors || []).forEach((extractor) => {
      addExtractor(samplerChildren, extractor);
    });

    (userDbOps[index] || []).forEach((op) => addJdbcPostProcessor(samplerChildren, op));

    const recordAsserts = userAsserts[index] || [];
    recordAsserts.forEach((assertion) => addConfiguredAssertion(samplerChildren, assertion));
    const statusNum = Number(record.responseStatus);
    const hasStatusAssert = recordAsserts.some((assertion) => assertion.source === 'status');
    if (!hasStatusAssert && Number.isInteger(statusNum) && statusNum >= 100 && statusNum <= 599) {
      addResponseAssertion(samplerChildren, statusNum);
    }

    added += 1;
  });

  if (added === 0) {
    throw new Error(
      skipped > 0
        ? `No valid HTTP(S) URLs to export (${skipped} skipped)`
        : 'No records provided to generate JMX'
    );
  }

  addViewResultsTree(samplersHashTree);

  return doc.end({ prettyPrint: true });
}

module.exports = {
  generateJMX
};
