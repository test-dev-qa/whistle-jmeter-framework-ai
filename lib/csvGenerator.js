const { normalizeHeaders } = require('./utils');

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toJSON(value) {
  try {
    return JSON.stringify(value || {});
  } catch (e) {
    return '{}';
  }
}

function generateCSV(records) {
  if (!records || records.length === 0) {
    throw new Error('No records provided to generate CSV');
  }

  const headers = [
    'ID',
    'Timestamp',
    'Time',
    'URL',
    'Method',
    'Request Headers',
    'Request Body',
    'Response Status',
    'Response Headers',
    'Response Body',
    'Multipart'
  ];

  const lines = [headers.join(',')];

  for (const record of records) {
    const ts = Number(record.timestamp);
    const isoTime = Number.isFinite(ts) ? new Date(ts).toISOString() : '';
    const line = [
      escapeCSV(record.id),
      escapeCSV(record.timestamp),
      escapeCSV(isoTime),
      escapeCSV(record.url),
      escapeCSV(record.method),
      escapeCSV(toJSON(normalizeHeaders(record.requestHeaders || record.headers))),
      escapeCSV(record.requestBodyBinary ? '[binary]' : (record.requestBody != null ? record.requestBody : record.body)),
      escapeCSV(record.responseStatus),
      escapeCSV(toJSON(normalizeHeaders(record.responseHeaders))),
      escapeCSV(record.responseBodyBinary ? '[binary]' : record.responseBody),
      escapeCSV(record.multipart ? toJSON(record.multipart) : '')
    ];
    lines.push(line.join(','));
  }

  return '\uFEFF' + lines.join('\n');
}

module.exports = {
  generateCSV
};
