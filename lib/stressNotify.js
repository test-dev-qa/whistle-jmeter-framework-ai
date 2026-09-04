'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { formatReportNotifyLabel } = require('./stressReportLabel');

function buildPayload(report, alerts) {
  const summary = (report && report.summary) || {};
  const failed = (alerts && alerts.items || []).filter((x) => !x.passed);
  const reportLabel = (report && report.notifyLabel) || formatReportNotifyLabel(report);
  return {
    event: alerts && alerts.passed ? 'stress.threshold.pass' : 'stress.threshold.fail',
    reportId: report && report.id,
    reportLabel,
    projectName: report && report.projectName,
    reportTitle: report && report.title,
    status: report && report.status,
    startedAt: report && report.startedAt,
    endedAt: report && report.endedAt,
    summary,
    alerts: {
      enabled: Boolean(alerts && alerts.enabled),
      passed: Boolean(alerts && alerts.passed),
      failedCount: alerts && alerts.failedCount || 0,
      items: failed.map((x) => ({
        key: x.key,
        label: x.label,
        apiName: x.apiName,
        actual: x.actual,
        threshold: x.threshold,
        op: x.op,
        unit: x.unit
      }))
    },
    text: formatText(report, alerts)
  };
}

function formatText(report, alerts) {
  const summary = (report && report.summary) || {};
  const reportLabel = (report && report.notifyLabel) || formatReportNotifyLabel(report);
  const lines = [
    `[压测阈值告警] ${alerts && alerts.passed ? '通过' : '未通过'}`,
    `报告: ${reportLabel}`,
    `状态: ${report && report.status || '-'}`,
    `总请求: ${summary.total || 0}  RPS: ${summary.rps || 0}`,
    `平均RT: ${summary.avgLatencyMs || 0}ms  P90: ${summary.p90LatencyMs || 0}ms`,
    `失败率: ${summary.failRate || 0}%`
  ];
  if (summary.avgDbLatencyMs != null) {
    lines.push(`平均DB耗时: ${summary.avgDbLatencyMs}ms  (次数 ${summary.dbTotal || 0})`);
  }
  (alerts && alerts.items || []).filter((x) => !x.passed).forEach((x) => {
    const apiPrefix = x.apiName ? `${x.apiName} - ` : '';
    lines.push(`- ${apiPrefix}${x.label}: 实际 ${x.actual}${x.unit}，阈值 ${x.op === 'gte' ? '≥' : '≤'} ${x.threshold}${x.unit}`);
  });
  return lines.join('\n');
}

function postJson(urlText, body, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(String(urlText || '').trim());
    } catch (e) {
      resolve({ ok: false, error: 'Webhook URL 无效' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      resolve({ ok: false, error: 'Webhook 仅支持 http/https' });
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': raw.length,
        'User-Agent': 'whistle.jmeter-exporter-notify/1.0'
      },
      timeout: timeoutMs || 8000
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        const code = Number(res.statusCode) || 0;
        resolve({
          ok: code >= 200 && code < 300,
          status: code,
          error: code >= 200 && code < 300 ? '' : `HTTP ${code}`
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Webhook 超时' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, error: err && err.message ? err.message : 'Webhook 失败' });
    });
    req.write(raw);
    req.end();
  });
}

function isFeishuWebhook(urlText) {
  return /feishu\.cn|larksuite\.com|open\.feishu|open\.larksuite/i.test(String(urlText || ''));
}

function buildFeishuPayload(report, alerts) {
  return {
    msg_type: 'text',
    content: {
      text: formatText(report, alerts)
    }
  };
}

function resolveNotifyBody(urlText, payload, report, alerts, conf) {
  const format = String((conf && conf.webhookFormat) || '').trim().toLowerCase();
  const useFeishu =
    format === 'feishu' ||
    format === 'lark' ||
    ((format === '' || format === 'auto') && isFeishuWebhook(urlText));
  if (useFeishu) {
    return buildFeishuPayload(report, alerts);
  }
  return payload;
}

async function probeWebhook(cfg) {
  const conf = cfg && typeof cfg === 'object' ? cfg : {};
  const webhookUrl = String(conf.webhookUrl || '').trim();
  if (!webhookUrl) return { ok: false, error: 'Webhook URL 为空' };

  const probeText = '[压测阈值] Webhook 连通性探测\n这是一条测试消息，可忽略。';
  const fakeReport = {
    id: 'webhook-probe',
    status: 'probe',
    startedAt: Date.now(),
    endedAt: Date.now(),
    summary: { total: 0, rps: 0, failRate: 0, avgLatencyMs: 0, p90LatencyMs: 0 }
  };
  const fakeAlerts = { enabled: true, passed: true, failedCount: 0, items: [] };
  const payload = buildPayload(fakeReport, fakeAlerts);
  payload.event = 'stress.webhook.probe';
  payload.text = probeText;

  const body = resolveNotifyBody(webhookUrl, payload, fakeReport, fakeAlerts, conf);
  const format = String(conf.webhookFormat || '').trim().toLowerCase();
  const useFeishu = format === 'feishu' || format === 'lark' || isFeishuWebhook(webhookUrl);
  if (useFeishu) {
    body.msg_type = 'text';
    body.content = { text: probeText };
  }

  const res = await postJson(webhookUrl, body, 8000);
  return Object.assign({ url: webhookUrl }, res);
}

async function notifyThresholdResult(report, alerts, cfg) {
  const conf = cfg && typeof cfg === 'object' ? cfg : {};
  if (!alerts || !alerts.enabled) {
    return { skipped: true, reason: 'threshold disabled' };
  }
  const should =
    (!alerts.passed && conf.webhookOnFail !== false) ||
    (alerts.passed && conf.webhookOnPass === true);
  if (!should) return { skipped: true, reason: 'notify not required' };

  const urls = [];
  const webhookUrl = String(conf.webhookUrl || '').trim();
  const emailHookUrl = String(conf.emailHookUrl || '').trim();
  if (webhookUrl) urls.push({ type: 'webhook', url: webhookUrl });
  if (emailHookUrl) urls.push({ type: 'emailHook', url: emailHookUrl });
  if (!urls.length) return { skipped: true, reason: 'no notify url' };

  const payload = buildPayload(report, alerts);
  if (conf.notifyEmail) payload.notifyEmail = String(conf.notifyEmail).trim();

  const results = [];
  for (let i = 0; i < urls.length; i += 1) {
    const item = urls[i];
    const body = item.type === 'webhook'
      ? resolveNotifyBody(item.url, Object.assign({}, payload, { channel: item.type }), report, alerts, conf)
      : Object.assign({}, payload, { channel: item.type });
    const res = await postJson(item.url, body, 8000);
    results.push(Object.assign({ type: item.type }, res));
  }
  return {
    skipped: false,
    ok: results.every((x) => x.ok),
    results
  };
}

module.exports = {
  buildPayload,
  buildFeishuPayload,
  formatText,
  isFeishuWebhook,
  postJson,
  probeWebhook,
  notifyThresholdResult
};
