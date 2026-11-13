import test from 'node:test';
import assert from 'node:assert/strict';
import { reflowReading } from '../src/reading.mjs';
import { separateFootnotes, FN_MARK, NOTE_MARK } from '../src/footnotes.mjs';

const REF = n => `${FN_MARK}(${n})${FN_MARK}`;
const NOTE = n => `${NOTE_MARK}(${n})${NOTE_MARK}`;

/* وثيقة صناعية على نمط ظهير محيَّن: كل صفحة متن بأرقام إحالة عارية ثم كتلة هوامش "N - ..." في أسفلها. */
function sample({ pages = 7, fakeHeading = false, enumerationFirst = false } = {}) {
  const lines = ['ظهير بمثابة قانون الالتزامات والعقود'];
  let n = 1;
  for (let p = 0; p < pages; p++) {
    lines.push('', `الفصل ${p + 1}`, '');
    if (enumerationFirst && p === 0) lines.push('4 - سبب مشروع للالتزام', '');
    const a = n, b = n + 1;
    lines.push(`يلتزم الطرف الأول بأداء الثمن ${a} في الأجل المتفق عليه بتاريخ 12 شتنبر 1913 وفقا للفصل ${b + 3} من هذا الظهير ${b}.`, '');
    const note = [`${a} - قارن مع القانون رقم ${40 + p} بتاريخ سابق، ص ${100 + p}.`, `${b} - ${fakeHeading && p === 2 ? '' : 'نص الهامش الثاني.'}`];
    lines.push(note.join(' '));
    if (fakeHeading && p === 2) lines.push('المادة 209', ': من مدونة الأسرة « سن الرشد القانوني 18 سنة شمسية كاملة.»');
    n += 2;
  }
  for (let k = 8; k <= 14; k++) lines.push('', `الفصل ${k}`, '', 'نص الفصل بلا هوامش.');
  return lines.join('\n');
}

test('كتل الهوامش تُفصل ويُعلَّم رقم الإحالة في المتن بأرقام صغيرة بين قوسين', () => {
  const { text, presentation } = reflowReading(sample());
  assert.ok(presentation.footnotes >= 10, JSON.stringify(presentation));
  assert.ok(text.includes(`الثمن${REF(1)}`) || text.includes(`الثمن ${REF(1)}`), text.slice(0, 500));
  assert.ok(text.includes(`${NOTE(1)} قارن مع القانون رقم 40`));
  assert.ok(text.split('\n\n').some(b => b.startsWith(NOTE(2) + ' نص الهامش الثاني')));
  assert.ok(!/(?:^|\n)\d+ - قارن/.test(text), 'لا تبقى كتلة هامش خام');
});

test('أرقام الفصول والتواريخ داخل المتن لا تُحوَّل إلى إحالات', () => {
  const { text } = reflowReading(sample());
  assert.ok(text.includes('وفقا للفصل 5 من هذا الظهير'));
  assert.ok(text.includes('12 شتنبر 1913'));
});

test('عنوان "المادة N" الدخيل داخل الهامش لا يخرج عنوانًا ويُضمّ إلى الهامش', () => {
  const { text, headings } = reflowReading(sample({ fakeHeading: true }));
  assert.ok(!headings.some(h => h.marker === 'المادة'), JSON.stringify(headings.filter(h => h.marker === 'المادة')));
  assert.ok(text.includes('المادة 209 : من مدونة الأسرة') || text.includes('المادة 209: من مدونة الأسرة'));
});

test('عدّ القائمة في بداية كتلة ("4 - سبب مشروع") لا يُعدّ هامشًا', () => {
  const { text } = reflowReading(sample({ enumerationFirst: true }));
  assert.ok(text.includes('\n\n4 - سبب مشروع للالتزام') || text.includes('4 -. سبب') || text.includes('4 - سبب مشروع للالتزام'));
  assert.ok(!text.includes(NOTE(4) + ' سبب مشروع'));
});

test('وثيقة بلا هوامش لا تتغير ولا تحمل علامات', () => {
  const raw = ['الفصل 1', '', 'يلتزم الطرف الأول بأداء الثمن 1 في الأجل.', '', 'الفصل 2', '', 'نص ثانٍ.'].join('\n');
  const r = reflowReading(raw);
  assert.equal(r.presentation.footnotes, 0);
  assert.ok(!r.text.includes(FN_MARK) && !r.text.includes(NOTE_MARK));
});

test('إعادة المعالجة (وثيقة مُدارة) مستقرة ولا تضاعف العلامات', () => {
  const once = reflowReading(sample()).text;
  const twice = reflowReading(once).text;
  assert.equal(twice, once);
});

test('separateFootnotes تتجاهل المجموعات القليلة (حماية من الإيجابيات الكاذبة)', () => {
  const blocks = ['نص 1 هنا', '1 - هامش واحد.', 'نص آخر'];
  assert.deepEqual(separateFootnotes(blocks).blocks, blocks);
});
