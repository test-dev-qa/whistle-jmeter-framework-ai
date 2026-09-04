'use strict';

const { test, assert, assertEqual } = require('./harness');
const shareDocs = require('../lib/shareDocs');

test('shareDocs / content limit is 1.5MB', () => {
  assertEqual(shareDocs.MAX_CONTENT_CHARS, 1.5 * 1024 * 1024);
});

test('shareDocs / create list update delete md', () => {
  const created = shareDocs.createDoc({
    title: '脚本仓库',
    format: 'md',
    content: '# hello\n\nworld'
  });
  assert(created.id);
  assertEqual(created.format, 'md');
  assert(created.slug.length > 4);

  const listed = shareDocs.listDocs({ q: '脚本' });
  assert(listed.some((x) => x.id === created.id));

  const updated = shareDocs.updateDoc(created.id, { title: '脚本仓库 v2', content: '# v2' });
  assertEqual(updated.title, '脚本仓库 v2');
  assertEqual(updated.content, '# v2');

  const versions = shareDocs.listDocVersions(created.id);
  assertEqual(versions.length, 1);
  assertEqual(versions[0].format, 'md');
  const snap = shareDocs.getDocVersion(created.id, versions[0].id);
  assert(snap.content.indexOf('hello') >= 0);

  shareDocs.updateDoc(created.id, { content: '# v3\n\nnew line' });
  const allVersions = shareDocs.listDocVersions(created.id);
  assertEqual(allVersions.length, 2);
  const cmp = shareDocs.compareDocVersions(created.id, allVersions[1].id, allVersions[0].id);
  assert(cmp.stats.added > 0 || cmp.stats.removed > 0);
  assert(cmp.lines.some((line) => line.op === 'add' || line.op === 'del'));

  const restored = shareDocs.restoreDocVersion(created.id, versions[0].id);
  assert(restored.content.indexOf('hello') >= 0);

  const html = shareDocs.renderDocHtml(updated);
  assert(html.indexOf('v2') >= 0);

  assertEqual(shareDocs.deleteDoc(created.id), true);
  assertEqual(shareDocs.getDoc(created.id), null);
});

test('shareDocs / import html and stations', () => {
  const station = shareDocs.createStation({ name: 'process4.0-team', url: 'tande-devops-api.example.cn' });
  assertEqual(station.name, 'process4.0-team');

  const imported = shareDocs.importDoc({
    filename: 'guide.html',
    content: '<h1>Guide</h1><p>ok</p>',
    stationId: station.id
  });
  assertEqual(imported.format, 'html');
  assertEqual(imported.fileType, 'html');
  assertEqual(imported.fileExt, 'html');
  assertEqual(imported.stationId, station.id);
  assertEqual(imported.source, 'import');

  const bySlug = shareDocs.getDocBySlug(imported.slug, true);
  assertEqual(bySlug.id, imported.id);

  let threw = false;
  try {
    shareDocs.deleteStation('local');
  } catch (e) {
    threw = true;
  }
  assert(threw);

  shareDocs.deleteDoc(imported.id);
  assertEqual(shareDocs.deleteStation(station.id), true);
});

test('shareDocs / detectImport docx extracts text', () => {
  const xml = Buffer.from(
    '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>HelloDocx</w:t></w:r></w:p></w:body></w:document>',
    'utf8'
  );
  const name = Buffer.from('word/document.xml', 'utf8');
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(xml.length, 18);
  localHeader.writeUInt32LE(xml.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);
  const zip = Buffer.concat([localHeader, name, xml]);
  const detected = shareDocs.detectImport('a.docx', zip.toString('base64'), true);
  assertEqual(detected.format, 'md');
  assert(detected.content.indexOf('HelloDocx') >= 0);
});

test('shareDocs / saveMedia and getMedia', () => {
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const saved = shareDocs.saveMedia({
    filename: 'dot.png',
    mime: 'image/png',
    contentBase64: png1x1.toString('base64')
  });
  assert(saved.name);
  assertEqual(saved.kind, 'image');
  const got = shareDocs.getMedia(saved.name);
  assert(got);
  assertEqual(got.mime, 'image/png');
  assertEqual(got.body.length, png1x1.length);
});

test('shareDocs / downloadPayload doc wraps html', () => {
  const doc = shareDocs.createDoc({
    title: 'word-doc',
    format: 'doc',
    content: '<p>body only</p>'
  });
  const payload = shareDocs.downloadPayload(doc);
  assertEqual(payload.contentType, 'application/msword');
  assert(payload.filename.endsWith('.doc'));
  assert(payload.body.toString('utf8').indexOf('<html') >= 0);
  assertEqual(doc.fileType, 'doc');
  shareDocs.deleteDoc(doc.id);
});

test('shareDocs / fileType from filename and video casing', () => {
  assertEqual(shareDocs.normalizeFileType('mp4'), 'MP4');
  assertEqual(shareDocs.normalizeFileType('JPG'), 'jpg');
  assertEqual(shareDocs.fileTypeFromFilename('photo.jpeg', 'md'), 'jpg');
  const imported = shareDocs.importDoc({
    filename: 'notes.txt',
    content: 'hello notes'
  });
  assertEqual(imported.format, 'md');
  assertEqual(imported.fileExt, 'txt');
  assertEqual(imported.fileType, 'txt');
  shareDocs.deleteDoc(imported.id);
});

test('shareDocs / sync pack export import roundtrip', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const media = shareDocs.saveMedia({
    mime: 'image/png',
    filename: 'dot.png',
    contentBase64: png.toString('base64')
  });
  const doc = shareDocs.createDoc({
    title: '同步样例',
    format: 'md',
    content: `# hi\n\n![](./api/share/media/${media.name})\n`,
    slug: 'sync-roundtrip-slug'
  });
  const pack = shareDocs.exportSyncPack({ docIds: [doc.id] });
  assert(Buffer.isBuffer(pack.body));
  assert(pack.body.length > 20);
  assertEqual(pack.meta.docs, 1);
  assertEqual(pack.meta.media, 1);

  shareDocs.deleteDoc(doc.id);

  const result = shareDocs.importSyncPack({ contentBase64: pack.body.toString('base64') });
  assertEqual(result.docs, 1);
  assertEqual(result.media, 1);
  assert(result.items[0].id);
  assertEqual(result.items[0].slug, 'sync-roundtrip-slug');
  const restored = shareDocs.getDoc(result.items[0].id, true);
  assert(restored.content.indexOf('api/share/media/') >= 0);
  shareDocs.deleteDoc(restored.id);
});

test('shareDocs / sync pack stream export import', async () => {
  const doc = shareDocs.createDoc({
    title: '流式导出',
    format: 'md',
    content: '# stream export',
    slug: 'stream-export-slug'
  });
  const payload = await shareDocs.exportSyncPackStream({ docIds: [doc.id], includeMedia: false });
  const chunks = [];
  for await (const chunk of payload.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  await payload.ready;
  const buf = Buffer.concat(chunks);
  assert(buf.length > 20);
  assertEqual(payload.meta.docs, 1);
  shareDocs.deleteDoc(doc.id);
  const result = shareDocs.importSyncPack({ content: buf });
  assertEqual(result.docs, 1);
  assertEqual(result.items[0].slug, 'stream-export-slug');
  shareDocs.deleteDoc(result.items[0].id);
});

test('shareDocs / sync pack import accepts raw buffer', () => {
  const doc = shareDocs.createDoc({
    title: '二进制导入',
    format: 'md',
    content: '# raw buffer'
  });
  const pack = shareDocs.exportSyncPack({ docIds: [doc.id], includeMedia: false });
  shareDocs.deleteDoc(doc.id);
  const result = shareDocs.importSyncPack({ content: pack.body });
  assertEqual(result.docs, 1);
  shareDocs.deleteDoc(result.items[0].id);
});
