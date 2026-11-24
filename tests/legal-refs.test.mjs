import test from 'node:test';
import assert from 'node:assert/strict';
import { brotliCompressSync } from 'node:zlib';
import { parseRefs, lawKeyOf } from '../src/legal-refs.mjs';
import { RefIndex, articleText } from '../src/ref-index.mjs';

test('الإحالات: الاختصارات والأسماء والأرقام، والفصل في المسطرة المدنية للظهير القديم والمادة للقانون 58.25', () => {
  const r = parseRefs('طبقاً للفصل 230 من ق.ل.ع والمادة 204 من القانون رقم 58.25 وخرقاً للفصلين 38 و39 من قانون المسطرة المدنية والمادة 94 من مدونة الأسرة');
  assert.deepEqual(r.map(x => [x.lawKey, x.articles]), [['qlo', ['230']], ['cpc', ['204']], ['cpc1974', ['38', '39']], ['family', ['94']]]);
  assert.deepEqual(parseRefs('الفصل 12 من الظهير المذكور'), []);
});

test('مفتاح القانون من عنوان الوثيقة ورقمها', () => {
  assert.equal(lawKeyOf('الالتزامات والعقود'), 'qlo');
  assert.equal(lawKeyOf('القانون رقم 58.25 المتعلق بالمسطرة المدنية', '58.25'), 'cpc');
  assert.equal(lawKeyOf('قانون المسطرة المدنية'), 'cpc1974');
  assert.equal(lawKeyOf('مدونة الأسرة'), 'family');
  assert.equal(lawKeyOf('مرسوم بتطبيق مدونة الأسرة'), '');
});

test('نص فصل واحد حتى الفصل الموالي', () => {
  const text = 'تمهيد\nالفصل 229\nنص سابق\nالفصل 230\nالالتزامات التعاقدية المنشأة على وجه صحيح تقوم مقام القانون.\nالفصل 231\nكل تعهد يجب تنفيذه بحسن نية.';
  assert.equal(articleText(text, 230), 'الفصل 230\nالالتزامات التعاقدية المنشأة على وجه صحيح تقوم مقام القانون.');
  assert.equal(articleText(text, 23), '');
});

test('النص المذيَّل: القرارات تُفهرس بفصول القانون الذي أحالت عليه', async () => {
  const body = s => brotliCompressSync(Buffer.from(s));
  const rows = {
    national: [{ id: 'law1', title: 'الالتزامات والعقود', law_number: '' }],
    decisions: [
      { id: 'd1', title: 'قرار 1', type: 'juriscassation', category: '', date: '2024-01-01', body: body('خرق الفصل 230 من ق.ل.ع') },
      { id: 'd2', title: 'قرار 2', type: 'juriscassation', category: '', date: '2025-01-01', body: body('الفصلين 230 و231 من قانون الالتزامات والعقود') },
    ],
  };
  const library = { managedDocs: new Map(), db: { prepare: sql => ({ all: () => (/type='national'/.test(sql) ? rows.national : rows.decisions) }) } };
  const index = new RefIndex(library);
  assert.equal(index.resolve('الفصل 230 من ق.ل.ع').id, 'law1');
  assert.equal(index.resolve('الفصل 230 من ق.ل.ع').needle, 'الفصل 230');
  const first = await index.annotationsFor({ title: 'الالتزامات والعقود' });
  assert.equal(first.building, true);
  await index.build();
  const ready = await index.annotationsFor({ title: 'الالتزامات والعقود' });
  assert.deepEqual(ready.articles['230'].map(d => d.id), ['d2', 'd1']);
  assert.deepEqual(ready.articles['231'].map(d => d.id), ['d2']);
});
