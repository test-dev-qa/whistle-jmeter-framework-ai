function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeHref(href) {
  const h = String(href || '').trim();
  if (/^https?:\/\//i.test(h) || h.startsWith('#') || h.startsWith('./') || h.startsWith('../')) {
    return h;
  }
  return '';
}

function renderInline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safe = sanitizeHref(href);
    if (!safe) return label;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return s;
}

function splitTableRow(line) {
  const trimmed = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  function flushList(items, tag) {
    if (!items.length) return;
    out.push('<' + tag + '>');
    items.forEach((item) => out.push('<li>' + renderInline(item) + '</li>'));
    out.push('</' + tag + '>');
    items.length = 0;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const lang = escapeHtml(line.slice(3).trim());
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      const cls = lang ? ` class="language-${lang}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\|/.test(line.trim()) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      out.push('<table><thead><tr>');
      headers.forEach((h) => out.push('<th>' + renderInline(h) + '</th>'));
      out.push('</tr></thead><tbody>');
      rows.forEach((row) => {
        out.push('<tr>');
        headers.forEach((_, idx) => out.push('<td>' + renderInline(row[idx] || '') + '</td>'));
        out.push('</tr>');
      });
      out.push('</tbody></table>');
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      flushList(items, 'ul');
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      flushList(items, 'ol');
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const para = [line];
    i += 1;
    while (i < lines.length && lines[i].trim()
      && !lines[i].startsWith('#')
      && !lines[i].startsWith('```')
      && !/^\|/.test(lines[i].trim())
      && !/^\s*[-*]\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i])
      && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())) {
      para.push(lines[i]);
      i += 1;
    }
    out.push('<p>' + renderInline(para.join(' ')) + '</p>');
  }

  return out.join('\n');
}

function wrapReadmePage(bodyHtml, title) {
  const { PLUGIN_WEB_ROOT } = require('./pluginPaths');
  const pageTitle = escapeHtml(title || '帮助文档');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background: #f5f7fa; color: #24292f; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 20px 20px 48px; }
    .card { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); padding: 24px 32px 40px; }
    h1, h2, h3 { border-bottom: 1px solid #eee; padding-bottom: 6px; }
    h1 { font-size: 28px; }
    h2 { font-size: 22px; margin-top: 32px; }
    h3 { font-size: 16px; border-bottom: none; }
    p, li { line-height: 1.65; }
    a { color: #1565c0; }
    code { background: #f6f8fa; padding: 1px 5px; border-radius: 4px; font-size: 90%; }
    pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow: auto; }
    pre code { padding: 0; background: transparent; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0 20px; }
    th, td { border: 1px solid #d0d7de; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f6f8fa; }
    hr { border: none; border-top: 1px solid #eee; margin: 24px 0; }
    .back { display: inline-block; margin-bottom: 12px; color: #1565c0; text-decoration: none; font-size: 13px; font-weight: 600; }
    .back:hover { text-decoration: underline; }
    .help-kicker { margin: 0 0 8px; color: #666; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; }
  </style>
</head>
<body>
  <div class="wrap">
    <a class="back" href="${PLUGIN_WEB_ROOT}">← 返回插件</a>
    <div class="card">
      <p class="help-kicker">帮助文档</p>
${bodyHtml}
    </div>
  </div>
</body>
</html>
`;
}

/** 分享文档页：默认铺满视口，适合列表「打开 / 全屏」预览 */
function wrapSharePage(bodyHtml, title) {
  const { PLUGIN_WEB_ROOT } = require('./pluginPaths');
  const pageTitle = escapeHtml(title || '分享文档');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>
    html, body { height: 100%; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 0;
      background: #fff;
      color: #24292f;
      min-height: 100vh;
    }
    .share-page {
      box-sizing: border-box;
      min-height: 100vh;
      width: 100%;
      padding: 16px 28px 48px;
      display: flex;
      flex-direction: column;
    }
    .share-page-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      flex-shrink: 0;
    }
    .share-page-bar .back {
      color: #1565c0;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
    }
    .share-page-bar .back:hover { text-decoration: underline; }
    .share-page-bar .title {
      font-size: 14px;
      font-weight: 600;
      color: #546e7a;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .share-page-body {
      flex: 1;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }
    h1, h2, h3 { border-bottom: 1px solid #eee; padding-bottom: 6px; }
    h1 { font-size: 28px; margin-top: 0; }
    h2 { font-size: 22px; margin-top: 32px; }
    h3 { font-size: 16px; border-bottom: none; }
    p, li { line-height: 1.65; }
    a { color: #1565c0; }
    code { background: #f6f8fa; padding: 1px 5px; border-radius: 4px; font-size: 90%; }
    pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow: auto; }
    pre code { padding: 0; background: transparent; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0 20px; }
    th, td { border: 1px solid #d0d7de; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f6f8fa; }
    hr { border: none; border-top: 1px solid #eee; margin: 24px 0; }
    img, video { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <div class="share-page">
    <div class="share-page-bar">
      <a class="back" href="${PLUGIN_WEB_ROOT}">← 返回列表</a>
      <span class="title">${pageTitle}</span>
    </div>
    <div class="share-page-body">
${bodyHtml}
    </div>
  </div>
</body>
</html>
`;
}

module.exports = {
  escapeHtml,
  markdownToHtml,
  wrapReadmePage,
  wrapSharePage
};
