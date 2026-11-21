import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const block = app.slice(app.indexOf('function setupReaderView'), app.indexOf('async function showEffectiveAlerts'));

test('وضع القارئ لا يُنشئ شريطاً عائماً يغطي الترويسة', () => {
  assert.ok(!/createElement\('div'\)[^;]*readerViewBar/.test(block) && !block.includes('document.body.prepend'));
  assert.ok(!readFileSync(new URL('../public/unified.css', import.meta.url), 'utf8').includes('#readerViewBar{'));
});

test('الأيقونة تتبدل بين العين ودرع المدير بحسب الوضع', () => {
  assert.ok(block.includes('button.innerHTML = reader'));
  assert.ok(block.includes('M12 3 4.5 6v5.5') && block.includes('circle cx="12" cy="12" r="3"'));
});
