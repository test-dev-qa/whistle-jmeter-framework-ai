'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./shareDocs');
const { atomicWriteFile } = require('./fsutil');

const WIKI_DIR = path.join(ROOT, 'wiki');
const RAW_DIR = path.join(ROOT, 'raw');
const INDEX_FILE = path.join(WIKI_DIR, 'index.md');
const LOG_FILE = path.join(WIKI_DIR, 'log.md');

function slugify(text) {
  return String(text || 'article')
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'article';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function ensureWikiLayout() {
  fs.mkdirSync(WIKI_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_FILE)) {
    atomicWriteFile(INDEX_FILE, '# Knowledge Base Index\n\n');
  }
  if (!fs.existsSync(LOG_FILE)) {
    atomicWriteFile(LOG_FILE, '# Wiki Log\n\n');
  }
}

function listArticles() {
  if (!fs.existsSync(INDEX_FILE)) return [];
  const text = fs.readFileSync(INDEX_FILE, 'utf8');
  const items = [];
  let topic = '';
  text.split(/\r?\n/).forEach((line) => {
    const sec = line.match(/^##\s+(\S+)\s*$/);
    if (sec) {
      topic = sec[1];
      return;
    }
    const link = line.match(/^-\s+\[(.+?)\]\((.+?)\)\s*(?:—|--|-)\s*(.+?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$/);
    if (link) {
      items.push({
        topic,
        title: link[1],
        path: link[2],
        summary: link[3],
        updated: link[4]
      });
    }
  });
  return items;
}

function appendLog(entry) {
  ensureWikiLayout();
  const lines = (entry.lines || []).map((line) => `- ${line}`).join('\n');
  const block = `\n## [${todayIso()}] ingest | ${entry.title}\n- Disposition: ${entry.disposition || 'New'}\n${lines}\n`;
  const prev = fs.readFileSync(LOG_FILE, 'utf8');
  atomicWriteFile(LOG_FILE, prev.endsWith('\n') ? prev + block : `${prev}\n${block}`);
}

function upsertIndexEntry({ topic, title, relPath, summary, date }) {
  ensureWikiLayout();
  let text = fs.readFileSync(INDEX_FILE, 'utf8');
  const line = `- [${title}](${relPath}) — ${summary} (${date})\n`;
  const sectionHeader = `## ${topic}`;
  const titleEsc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existingRe = new RegExp(`^- \\[${titleEsc}\\]\\([^)]+\\)[^\n]*\\n`, 'm');
  if (existingRe.test(text)) {
    text = text.replace(existingRe, line);
  } else if (text.includes(sectionHeader)) {
    text = text.replace(sectionHeader, `${sectionHeader}\n${line}`);
  } else {
    text += `\n${sectionHeader}\n${line}`;
  }
  atomicWriteFile(INDEX_FILE, text);
}

function ingest(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const topic = slugify(body.topic || 'general');
  const title = String(body.title || 'Untitled').trim().slice(0, 200);
  const content = String(body.content == null ? '' : body.content);
  if (!title) throw new Error('标题不能为空');
  if (!content.trim()) throw new Error('内容不能为空');
  const date = todayIso();
  ensureWikiLayout();
  fs.mkdirSync(path.join(RAW_DIR, topic), { recursive: true });
  fs.mkdirSync(path.join(WIKI_DIR, topic), { recursive: true });

  const rawName = `${date}-${slugify(title)}.md`;
  const rawRel = `raw/${topic}/${rawName}`;
  const rawPath = path.join(ROOT, rawRel);
  const sourceNote = body.sourceNote ? String(body.sourceNote) : '';
  const rawBody = [
    `# ${title}`,
    '',
    `Ingested: ${date}`,
    '',
    sourceNote ? `Source: ${sourceNote}` : '',
    sourceNote ? '' : '',
    content,
    ''
  ].filter((part, idx, arr) => !(part === '' && idx === arr.length - 1)).join('\n');
  atomicWriteFile(rawPath, rawBody);

  const articleSlug = slugify(title);
  const articleRel = `${topic}/${articleSlug}.md`;
  const articlePath = path.join(WIKI_DIR, topic, `${articleSlug}.md`);
  const rawLink = `../../${rawRel.replace(/\\/g, '/')}`;
  const summary = String(body.summary || title).trim().slice(0, 120);
  let disposition = body.disposition === 'Update' ? 'Update' : 'New';

  if (fs.existsSync(articlePath)) {
    disposition = 'Update';
    let articleText = fs.readFileSync(articlePath, 'utf8');
    articleText = articleText.replace(/^Updated:.*$/m, `Updated: ${date}`);
    if (!/^## Raw/m.test(articleText)) {
      articleText += `\n## Raw\n\n- [${rawName}](${rawLink})\n`;
    } else {
      articleText += `\n- [${rawName}](${rawLink})\n`;
    }
    atomicWriteFile(articlePath, articleText);
  } else {
    const articleText = [
      `# ${title}`,
      '',
      `Updated: ${date}`,
      '',
      '## Summary',
      '',
      summary,
      '',
      '## Content',
      '',
      content.slice(0, 8000),
      '',
      '## Raw',
      '',
      `- [${rawName}](${rawLink})`,
      ''
    ].join('\n');
    atomicWriteFile(articlePath, articleText);
  }

  upsertIndexEntry({ topic, title, relPath: articleRel, summary, date });
  appendLog({
    title,
    disposition,
    lines: [`Article: ${articleRel}`, `Raw: ${rawRel}`]
  });

  return {
    topic,
    title,
    disposition,
    articlePath: articleRel,
    rawPath: rawRel,
    wikiRoot: ROOT
  };
}

function ingestFromShareDoc(docId) {
  const shareDocs = require('./shareDocs');
  const doc = shareDocs.getDoc(docId, true);
  if (!doc) throw new Error('文档不存在');
  const topic = slugify(doc.stationId || 'share');
  return ingest({
    topic,
    title: doc.title,
    content: doc.content,
    summary: `${doc.format || 'md'} 分享文档`,
    sourceNote: `share-doc:${doc.id}`
  });
}

module.exports = {
  WIKI_DIR,
  RAW_DIR,
  listArticles,
  ingest,
  ingestFromShareDoc
};
