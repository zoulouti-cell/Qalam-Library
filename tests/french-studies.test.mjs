import test from 'node:test';
import assert from 'node:assert/strict';
import { bundledFrenchStudies } from '../src/french-studies-content.mjs';

test('دراسات القسم الفرنسي: ثلاث بطاقات بأصول PDF وHTML وMarkdown وعرض عربي', () => {
  assert.equal(bundledFrenchStudies.length, 3);
  const ids = new Set(), drive = new Set();
  for (const d of bundledFrenchStudies) {
    assert.equal(d.category, 'دراسات فرنسية');
    assert.equal(d.country, 'fr');
    assert.equal(d.sourceLanguage, 'fr');
    assert.ok(d.originalTitle && /[A-Za-z]/.test(d.originalTitle));
    assert.match(d.text, /^بطاقة مختصرة\n/u);
    assert.ok(d.text.length > 2500);
    assert.deepEqual(d.originalFiles.map(f => f.ext), ['pdf', 'html', 'md']);
    for (const f of d.originalFiles) { assert.ok(f.driveId); assert.ok(!drive.has(f.driveId)); drive.add(f.driveId); }
    assert.ok(!ids.has(d.documentId)); ids.add(d.documentId);
    assert.equal(d.reviewStatus, 'needs_review');
    assert.equal(d.professionalArabicReviewed, false);
  }
});
