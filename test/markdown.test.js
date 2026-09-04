'use strict';

const { test, assert, assertMatch } = require('./harness');
const { markdownToHtml, wrapReadmePage, wrapSharePage } = require('../lib/markdown');

test('markdown / heading list code and bold', () => {
  const html = markdownToHtml('# Title\n\n- one\n- two\n\nUse **bold** and `code`.\n');
  assertMatch(html, /<h1>Title<\/h1>/);
  assertMatch(html, /<ul>/);
  assertMatch(html, /<li>one<\/li>/);
  assertMatch(html, /<strong>bold<\/strong>/);
  assertMatch(html, /<code>code<\/code>/);
});

test('markdown / fence and table', () => {
  const md = [
    '```text',
    'hello <world>',
    '```',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |'
  ].join('\n');
  const html = markdownToHtml(md);
  assertMatch(html, /<pre><code class="language-text">hello &lt;world&gt;<\/code><\/pre>/);
  assertMatch(html, /<th>A<\/th>/);
  assertMatch(html, /<td>1<\/td>/);
});

test('markdown / http link allowed, javascript rejected', () => {
  const html = markdownToHtml('See [Whistle](https://wproxy.org/whistle/) and [bad](javascript:alert(1)).');
  assertMatch(html, /href="https:\/\/wproxy\.org\/whistle\/"/);
  assert(html.indexOf('javascript:') === -1);
  assertMatch(html, /Whistle/);
});

test('markdown / wrapReadmePage includes title and body', () => {
  const page = wrapReadmePage('<h1>Hi</h1>', '帮助文档');
  assertMatch(page, /<title>帮助文档<\/title>/);
  assertMatch(page, /帮助文档/);
  assertMatch(page, /<h1>Hi<\/h1>/);
});

test('markdown / wrapSharePage is full-bleed without help kicker', () => {
  const page = wrapSharePage('<h1>Hi</h1>', '分享标题');
  assertMatch(page, /<title>分享标题<\/title>/);
  assertMatch(page, /share-page/);
  assertMatch(page, /返回列表/);
  assert(page.indexOf('帮助文档') === -1);
  assertMatch(page, /<h1>Hi<\/h1>/);
});
