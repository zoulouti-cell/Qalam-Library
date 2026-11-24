import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanFollow, followId, matches, digest, digestMail } from '../src/follows.mjs';

const item = (title, summary = '', extra = {}) => ({ _id: title, title, summary, state: 'published', ...extra });

test('تنقية المتابعة ومعرّفها', () => {
  assert.deepEqual(cleanFollow({ type: 'law', key: 'family', title: 'مدونة الأسرة' }), { type: 'law', key: 'family', title: 'مدونة الأسرة' });
  assert.equal(cleanFollow({ type: 'law', key: 'x y' }), null);
  assert.equal(cleanFollow({ type: 'topic', q: ' a ' }), null);
  assert.equal(followId(cleanFollow({ type: 'topic', q: 'التطليق للشقاق' })), 'topic:التطليق للشقاق');
});

test('مطابقة القانون بالعنوان أو بالإحالة، والموضوع بكل كلماته', () => {
  const law = { type: 'law', key: 'family' };
  assert.ok(matches(item('قرار في النفقة', 'الجهة والمراجع: ... المادة 94 من مدونة الأسرة'), law));
  assert.ok(matches(item('مدونة الأسرة'), law));
  assert.ok(!matches(item('قرار تجاري', 'الفصل 230 من ق.ل.ع'), law));
  const topic = { type: 'topic', q: 'التطليق للشقاق' };
  assert.ok(matches(item('قرار', 'الكلمات المفتاحية: التطليق للشقاق، نفقة'), topic));
  assert.ok(!matches(item('قرار', 'الكلمات المفتاحية: نفقة'), topic));
});

test('بريد واحد مجمّع لكل مستخدم بما يخصه وحده', () => {
  const items = [item('أ', 'المادة 94 من مدونة الأسرة', { documentId: 'monitor-a' }), item('ب', 'الفصل 230 من ق.ل.ع')];
  const users = [{ email: 'x@y.ma', follows: [{ type: 'law', key: 'family', title: 'مدونة الأسرة' }] }, { email: 'z@y.ma', follows: [{ type: 'topic', q: 'صعوبات المقاولة' }] }];
  const out = digest(items, users);
  assert.deepEqual([...out.keys()], ['x@y.ma']);
  const mail = digestMail(out.get('x@y.ma'), 'https://lib');
  assert.match(mail.subject, /1 مستجد/);
  assert.match(mail.text, /https:\/\/lib\/\?doc=monitor-a/);
  assert.match(mail.html, /يخص: مدونة الأسرة/);
});
