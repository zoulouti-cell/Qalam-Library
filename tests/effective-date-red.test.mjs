/* تاريخ النفاذ ينتقل من بطاقة الرصد إلى المادة المنشورة ليظهر بالأحمر في «نصوص عامة»؛ والإشعار ليوم النفاذ وحده. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationRecord, effectiveToday } from '../src/legal-monitoring.mjs';

const base = { country: 'ma', kind: 'legislation', title: 'قانون رقم 12.34 يتعلق بتنظيم المهنة', originalTitle: '', source: { label: 'الجريدة الرسمية', url: 'https://example.org/a' }, eventDate: '2026-11-01', effectiveDate: '2026-12-01', summary: 'الجهة والمراجع: الجريدة الرسمية.\nالملخص: ملخص كاف لاجتياز حد الطول المطلوب في الاختبار وفق الصيغة المعتمدة.' };

test('سجل المادة المنشورة يحمل تاريخ النفاذ', () => {
  const rec = publicationRecord({ id: 'x'.repeat(24), state: 'published', ...base });
  assert.equal(rec.effectiveDate, '2026-12-01');
  assert.equal(publicationRecord({ id: 'y'.repeat(24), state: 'published', ...base, effectiveDate: '' }).effectiveDate, '');
});

test('إشعار النفاذ يظهر يوم النفاذ وحده', () => {
  const item = { id: 'a1', title: 'عنوان', country: 'ma', state: 'published', effectiveDate: '2026-12-01' };
  assert.equal(effectiveToday([item], '2026-12-01').length, 1);
  assert.equal(effectiveToday([item], '2026-12-02').length, 0);
  assert.equal(effectiveToday([item], '2026-11-30').length, 0);
});
