import test from 'node:test';
import assert from 'node:assert/strict';
import { makeObservation } from '../src/legal-monitoring.mjs';

test('الأصل المكرر في original وoriginals لا يظهر مرتين', () => {
  const file = { driveId: 'abc123', url: 'https://drive.google.com/file/d/abc123/view', name: 'x.md' };
  const obs = makeObservation({ country: 'fr', kind: 'legislation', title: 'مرسوم', originalTitle: 'Décret', summary: 'الجهة والمراجع: الجريدة الرسمية.\nالملخص: ملخص كاف لاجتياز حد الطول الأدنى للبطاقة.', eventDate: '2026-11-18', officialNumber: '2026-1053', source: { url: 'https://www.legifrance.gouv.fr/eli/decret/2026/11/17/x/jo/texte', label: 'Légifrance', official: true, verified: true }, original: file, originals: [file, { driveId: 'zzz', name: 'y.pdf' }] });
  assert.equal(obs.record.originals.length, 2);
  assert.deepEqual(obs.record.originals.map(o => o.driveId), ['abc123', 'zzz']);
});
