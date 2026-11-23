import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const pub = new URL('../public/', import.meta.url);
test('ملف الهوية الموحّدة محمّل أولاً في كل الصفحات', () => {
  for (const f of readdirSync(pub).filter(n => n.endsWith('.html'))) {
    const html = readFileSync(new URL(f, pub), 'utf8');
    assert.ok(html.includes('href="/tokens.css"'), f);
    const first = html.indexOf('href="/tokens.css"'), other = html.search(/href="\/(?!tokens)[^"]+\.css"/);
    assert.ok(other === -1 || first < other, f + ': tokens.css قبل سائر الأنماط');
  }
});
test('الخطوط موحّدة بالمتغيرات خارج تعريفات @font-face', () => {
  for (const f of readdirSync(pub).filter(n => n.endsWith('.css') && n !== 'tokens.css')) {
    const css = readFileSync(new URL(f, pub), 'utf8').replace(/@font-face\s*\{[^}]*\}/g, '');
    const raw = [...css.matchAll(/font-family:\s*([^;}]+)/g)].map(m => m[1].trim()).filter(v => !/^var\(--q-font|^inherit$|monospace/.test(v));
    assert.deepEqual(raw, [], f);
  }
});
test('المكتبة المساعدة المشتركة تغني عن النسخ المكررة في صفحات الإدارة', () => {
  const common = readFileSync(new URL('common.js', pub), 'utf8');
  assert.ok(common.includes('window.Qalam=Object.freeze({esc,api,post})'));
  for (const f of ['admin.js', 'admin-trash.js', 'admin-audit.js', 'admin-contrib.js', 'admin-import.js']) assert.ok(!/async function api\(/.test(readFileSync(new URL(f, pub), 'utf8')), f);
  const admin = readFileSync(new URL('admin.html', pub), 'utf8');
  assert.ok(admin.indexOf('/common.js') < admin.indexOf('/admin.js'));
});
