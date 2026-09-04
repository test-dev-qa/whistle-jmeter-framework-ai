'use strict';

const { test, assert, assertEqual } = require('./harness');
const memoryBridge = require('../lib/memoryBridge');

test('memoryBridge / buildShareAnchorText is pointer-only', () => {
  const text = memoryBridge.buildShareAnchorText({
    id: 'doc1',
    title: '压测说明',
    slug: 'stress-guide',
    format: 'md',
    stationId: 'local',
    content: '# hello\n\nworld body that should only appear as excerpt'
  });
  assert(text.indexOf('share-doc anchor: 压测说明') >= 0);
  assert(text.indexOf('slug: stress-guide') >= 0);
  assert(text.indexOf('path: /share/stress-guide') >= 0);
  assert(text.indexOf('not rewritten') >= 0);
  assert(text.indexOf('excerpt:') >= 0);
});

test('memoryBridge / dryRun does not call CLI', () => {
  const out = memoryBridge.addShareDocAnchor(
    { id: 'x', title: 't', slug: 's', format: 'md', content: 'c' },
    { dryRun: true }
  );
  assertEqual(out.ok, true);
  assertEqual(out.dryRun, true);
  assert(out.tags.indexOf('share-doc') >= 0);
});

test('memoryBridge / pinShareDocAnchors batch dryRun', () => {
  const batch = memoryBridge.pinShareDocAnchors([
    { id: 'a', title: 'A', slug: 'a', format: 'md', content: 'x' },
    { id: 'b', title: 'B', slug: 'b', format: 'md', content: 'y' }
  ], { dryRun: true });
  assertEqual(batch.ok, 2);
  assertEqual(batch.fail, 0);
  assertEqual(batch.items.length, 2);
});

test('memoryBridge / sanitizeTags hardens csv and whitespace', () => {
  const tags = memoryBridge.sanitizeTags(['share-doc', 'a,b', 'line\nbreak', '  spaced  ']);
  assertEqual(tags[0], 'share-doc');
  assertEqual(tags[1], 'a_b');
  assert(tags[2].indexOf('line') >= 0);
  assertEqual(tags[3], '_spaced_');
});

test('memoryBridge / buildHandoverText five lines', () => {
  const text = memoryBridge.buildHandoverText({
    goal: 'ship v1.1',
    done: 'k6 export',
    next: 'websocket capture'
  });
  assert(text.indexOf('goal: ship v1.1') >= 0);
  assert(text.indexOf('next: websocket capture') >= 0);
});

test('memoryBridge / addHandover dryRun', () => {
  const out = memoryBridge.addHandover({ goal: 'test', refs: 'README.md' }, { dryRun: true });
  assertEqual(out.dryRun, true);
  assert(out.tags.includes('handover'));
});

test('memoryBridge / resolveMembridgeRunner prefers python module when needed', () => {
  const runner = memoryBridge.resolveMembridgeRunner();
  assert(runner && runner.cmd);
  assert(['env', 'path', 'python-module', 'fallback'].includes(runner.via));
  if (runner.via === 'python-module') {
    assertEqual(runner.baseArgs.join(' '), '-m membridge');
  }
});
