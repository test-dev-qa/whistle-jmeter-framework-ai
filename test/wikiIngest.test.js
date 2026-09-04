'use strict';

const fs = require('fs');
const path = require('path');
const { test, assert, assertEqual } = require('./harness');
const shareDocs = require('../lib/shareDocs');
const wikiIngest = require('../lib/wikiIngest');

test('wikiIngest / ingest writes raw wiki index and log', () => {
  const root = process.env.JMETER_EXPORTER_DOCS_DIR;
  assert(root);
  const result = wikiIngest.ingest({
    topic: 'test-topic',
    title: 'Hello Wiki',
    content: '# body\n\nline',
    summary: 'test summary'
  });
  assertEqual(result.disposition, 'New');
  assert(fs.existsSync(path.join(root, result.rawPath)));
  assert(fs.existsSync(path.join(wikiIngest.WIKI_DIR, result.articlePath)));
  const items = wikiIngest.listArticles();
  assert(items.some((item) => item.title === 'Hello Wiki'));
});

test('wikiIngest / ingestFromShareDoc', () => {
  const created = shareDocs.createDoc({
    title: 'Wiki Source',
    format: 'md',
    content: '# from share'
  });
  const result = wikiIngest.ingestFromShareDoc(created.id);
  assertEqual(result.title, 'Wiki Source');
  assert(result.articlePath.indexOf('share') >= 0 || result.topic);
  shareDocs.deleteDoc(created.id);
});
