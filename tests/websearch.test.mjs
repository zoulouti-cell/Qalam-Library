import test from 'node:test';
import assert from 'node:assert/strict';
import { stripTags, decodeDuckUrl, parseDuckResults } from '../src/websearch.mjs';

test('stripTags removes markup and decodes common entities', () => {
  assert.equal(stripTags('<b>Hello</b> &amp; <i>world</i>'), 'Hello & world');
  assert.equal(stripTags('  a   b  '), 'a b');
});

test('decodeDuckUrl unwraps DuckDuckGo redirect links and passes through plain URLs', () => {
  assert.equal(decodeDuckUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=1'), 'https://example.com/page');
  assert.equal(decodeDuckUrl('https://example.org/direct'), 'https://example.org/direct');
  assert.equal(decodeDuckUrl('javascript:alert(1)'), '');
});

test('parseDuckResults extracts title, snippet and resolved link, capped at the limit', () => {
  const html = `
    <div class="result results_links results_links_deep web-result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F1">عنوان أول</a>
      <a class="result__snippet">مقتطف <b>أول</b></a>
    </div>
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F2">عنوان ثانٍ</a>
      <a class="result__snippet">مقتطف ثانٍ</a>
    </div>
  `;
  const items = parseDuckResults(html, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'عنوان أول');
  assert.equal(items[0].officialUrl, 'https://example.com/1');
  assert.equal(items[0].excerpt, 'مقتطف أول');
  assert.equal(items[0].answerReady, true);
});
