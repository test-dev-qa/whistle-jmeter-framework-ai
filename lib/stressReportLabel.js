'use strict';

const projectSettings = require('./projectSettings');

function formatReportTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '-';
  const d = new Date(n);
  const pad = (v) => String(v).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
    + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function formatReportTitle(report) {
  const src = report && typeof report === 'object' ? report : {};
  if (src.title) return String(src.title).trim();
  const s = src.summary || {};
  const c = src.config || {};
  return [
    formatReportTime(src.startedAt || src.createdAt),
    '并发' + (Number(c.users) || 0),
    (Number(s.total) || 0) + '次',
    'RPS ' + (Number(s.rps) || 0),
    src.status || ''
  ].filter(Boolean).join(' · ');
}

function resolveProjectName(report, override) {
  const fromReport = report && report.projectName ? String(report.projectName).trim() : '';
  if (fromReport) return fromReport;
  const fromOverride = override ? String(override).trim() : '';
  if (fromOverride) return fromOverride;
  return String((projectSettings.get() || {}).name || '').trim();
}

function formatReportNotifyLabel(report, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const projectName = resolveProjectName(report, options.projectName);
  const title = formatReportTitle(report);
  if (projectName && title) return projectName + ' · ' + title;
  if (title) return title;
  if (projectName) return projectName + ' · ' + ((report && report.id) || '-');
  return (report && report.id) || '-';
}

function attachReportLabels(report, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const src = report && typeof report === 'object' ? report : {};
  const projectName = resolveProjectName(src, options.projectName);
  const title = formatReportTitle(src);
  return Object.assign({}, src, {
    projectName,
    title,
    notifyLabel: formatReportNotifyLabel(Object.assign({}, src, { projectName, title }), options)
  });
}

module.exports = {
  formatReportTime,
  formatReportTitle,
  formatReportNotifyLabel,
  attachReportLabels,
  resolveProjectName
};
