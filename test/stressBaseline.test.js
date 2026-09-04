'use strict';

const { test, assertEqual } = require('./harness');
const baseline = require('../lib/stressBaseline');

test('stressBaseline / set and clear', () => {
  baseline.setBaseline('rpt-001', { label: 'release-1.0' });
  const got = baseline.get();
  assertEqual(got.reportId, 'rpt-001');
  assertEqual(got.label, 'release-1.0');
  assertEqual(Boolean(got.pinnedAt), true);
  baseline.clearIfMatches('rpt-other');
  assertEqual(baseline.get().reportId, 'rpt-001');
  baseline.clearIfMatches('rpt-001');
  assertEqual(baseline.get().reportId, '');
});

test('stressBaseline / clearBaseline', () => {
  baseline.setBaseline('rpt-002');
  baseline.clearBaseline();
  assertEqual(baseline.get().reportId, '');
});
