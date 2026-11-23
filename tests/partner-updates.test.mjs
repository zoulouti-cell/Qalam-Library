import test from 'node:test';
import assert from 'node:assert/strict';
import { partnerUpdates } from '../src/legal-monitoring.mjs';

const now = new Date('2026-11-24T10:00:00Z');
const item = (id, days, extra = {}) => ({ id, state: 'published', publishedAt: new Date(now.getTime() - days * 86400000), title: 'ت' + id, country: 'ma', kind: 'case_law', ...extra });

test('مستجدات الشهر المنشورة وحدها، بكلماتها المفتاحية ودون الملخص', () => {
  const rows = [
    item('a', 2, { summary: 'الملخص: ...\nالكلمات المفتاحية: نفقة، تطليق للشقاق, مدونة الأسرة', caseNumber: '123/2' }),
    item('b', 40),
    item('c', 1, { state: 'held' }),
  ];
  const out = partnerUpdates(rows, now);
  assert.deepEqual(out.map(u => u.id), ['a']);
  assert.deepEqual(out[0].keywords, ['نفقة', 'تطليق للشقاق', 'مدونة الأسرة']);
  assert.equal(out[0].reference, '123/2');
  assert.equal(out[0].documentId, 'monitor-a');
  assert.equal('summary' in out[0], false);
});
