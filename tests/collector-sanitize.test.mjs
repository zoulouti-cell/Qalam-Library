import test from 'node:test';
import assert from 'node:assert/strict';
import { arabicSourceLabel, stripTechnicalNotes, makeObservation } from '../src/legal-monitoring.mjs';

test('عنوان المصدر الفرنسي يصير عربياً بالعدد والتاريخ', () => {
  assert.equal(arabicSourceLabel('Légifrance — JORF n°0269 du 18 novembre 2026'), 'الجريدة الرسمية الفرنسية (Légifrance) — العدد 0269 بتاريخ 18 نونبر 2026');
  assert.equal(arabicSourceLabel('Légifrance — Journal officiel'), 'الجريدة الرسمية الفرنسية (Légifrance)');
});
test('العنوان العربي لا يُمسّ', () => {
  const l = 'الجريدة الرسمية الفرنسية (Légifrance) — العدد 0268 بتاريخ 17 نونبر 2026';
  assert.equal(arabicSourceLabel(l), l);
  assert.equal(arabicSourceLabel('المحكمة الدستورية'), 'المحكمة الدستورية');
});
test('الملاحظة التقنية تُحذف من المتن', () => {
  const t = 'نص كامل محفوظ في Drive؛ تعذّر PDF رسمي (Légifrance يحجب curl)؛ والرابط الرسمي أعلاه.';
  assert.ok(!/curl/.test(stripTechnicalNotes(t)));
  assert.match(stripTechnicalNotes(t), /والرابط الرسمي أعلاه/);
});
test('makeObservation يطبّق التطبيع', () => {
  const r = makeObservation({ country: 'fr', kind: 'legislation', title: 'مرسوم تجريبي للاختبار', summary: 'الملخص: '.padEnd(80, 'ن') + '؛ تعذّر PDF (يحجب curl)؛ والرابط أعلاه.', eventDate: '2026-11-17', source: { url: 'https://www.legifrance.gouv.fr/eli/decret/2026/11/17/X/jo/texte', label: 'Légifrance — JORF n°0269 du 18 novembre 2026', official: true, verified: true }, complete: true });
  assert.ok(!r.error, r.error);
  assert.match(r.record.source.label, /^الجريدة الرسمية الفرنسية/);
  assert.ok(!/curl/.test(r.record.summary));
});
