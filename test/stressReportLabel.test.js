'use strict';

const { test, assertEqual } = require('./harness');
const projectSettings = require('../lib/projectSettings');
const stressReportLabel = require('../lib/stressReportLabel');

test('projectSettings / save and get', () => {
  const saved = projectSettings.save({ name: '订单中心', description: '回归' });
  assertEqual(saved.name, '订单中心');
  assertEqual(projectSettings.get().name, '订单中心');
});

test('stressReportLabel / formatReportNotifyLabel combines project and title', () => {
  const report = {
    id: 'mtjjz7la-zz3brjrr',
    status: 'finished',
    startedAt: Date.UTC(2026, 8, 2, 3, 30, 0),
    config: { users: 10 },
    summary: { total: 1000, rps: 50 }
  };
  const label = stressReportLabel.formatReportNotifyLabel(report, { projectName: '订单中心' });
  assertEqual(label.indexOf('订单中心') >= 0, true);
  assertEqual(label.indexOf('并发10') >= 0, true);
  assertEqual(label.indexOf('mtjjz7la') >= 0, false);
});

test('stressReportLabel / attachReportLabels sets title and notifyLabel', () => {
  projectSettings.save({ name: '支付网关' });
  const attached = stressReportLabel.attachReportLabels({
    id: 'r1',
    status: 'finished',
    startedAt: Date.UTC(2026, 8, 2, 4, 0, 0),
    config: { users: 5 },
    summary: { total: 100, rps: 10 }
  });
  assertEqual(attached.projectName, '支付网关');
  assertEqual(attached.title.indexOf('并发5') >= 0, true);
  assertEqual(attached.notifyLabel.indexOf('支付网关') >= 0, true);
});
