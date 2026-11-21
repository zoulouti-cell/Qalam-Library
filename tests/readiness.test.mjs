/* تقرير الجاهزية: ما اكتمل في بطاقة تنتظر الاعتماد وما ينقص، واقتراح القانون القديم. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readinessOf, lawNumberOf } from '../src/legal-monitoring.mjs';

test('رقم النص يُستخرج من العنوان بأرقام لاتينية أو هندية', () => {
  assert.equal(lawNumberOf('قانون رقم 12.34 يتعلق بتنظيم المهنة'), '12.34');
  assert.equal(lawNumberOf('ظهير شريف رقم 1.59.413 بمثابة قانون'), '1.59.413');
  assert.equal(lawNumberOf('مرسوم رقم ٢.٢٤.١٠٤٢'), '2.24.1042');
  assert.equal(lawNumberOf('مقال دون رقم'), '');
});

test('بطاقة قانون مكتملة الأصل والنص مع اقتراح قديم: جاهزة', () => {
  const r = readinessOf({ kind: 'legislation', country: 'ma', original: { driveId: 'd1' }, fullText: 'ن'.repeat(500), source: { url: 'https://x.org/a' } }, { id: 'old1', title: 'قانون قديم' });
  assert.equal(r.original.state, 'ok'); assert.equal(r.text.state, 'ok');
  assert.equal(r.oldLaw.state, 'suggested'); assert.equal(r.oldLaw.id, 'old1');
  assert.equal(r.complete, true);
});

test('ما ينقص يظهر: أصل غير مرفق ونص ملخص ولا قانون قديم', () => {
  const r = readinessOf({ kind: 'legislation', country: 'ma', fullText: 'قصير', source: { url: 'https://x.org/a' } }, null);
  assert.equal(r.original.state, 'missing'); assert.equal(r.text.state, 'missing'); assert.equal(r.oldLaw.state, 'missing');
  assert.equal(r.complete, false);
});

test('الأصل القابل للجلب من رابط PDF رسمي، والاجتهاد لا قانون قديم له', () => {
  const r = readinessOf({ kind: 'case_law', country: 'fr', fullText: 'ن'.repeat(600), source: { url: 'https://site.fr/decision.pdf' } });
  assert.equal(r.original.state, 'fetchable'); assert.equal(r.oldLaw.state, 'na'); assert.equal(r.complete, false);
});

test('القسم المحدد من المدير يغلب المقترح', () => {
  assert.equal(readinessOf({ kind: 'legislation', country: 'ma', publishCategory: 'نصوص عامة' }).place.state, 'ok');
  assert.equal(readinessOf({ kind: 'legislation', country: 'ma' }).place.state, 'suggested');
});
