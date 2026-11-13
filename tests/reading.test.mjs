import test from 'node:test';
import assert from 'node:assert/strict';
import { reflowReading, stripInlinePageMarkers } from '../src/reading.mjs';

const filler = n => Array.from({ length: 18 }, (_, i) => `الجملة رقم ${n}${i} تتناول التزامات الأطراف وآثار العقد بينهم`).join(' ');
const pages = (first, count, glue) => Array.from({ length: count }, (_, i) => filler(i) + glue(first + i)).join('\n');

test('رقم الصفحة المقسوم على ثلاثة أسطر يُنزع من وسط الفقرة', () => {
  const raw = pages(10, 7, n => `\n-\n${n}\n-\n`);
  const { text, presentation } = reflowReading(raw);
  assert.ok(!/(?:^|\s)[-–—]\s*\d{1,3}\s*[-–—](?:\s|$)/.test(text), text.slice(0, 400));
  assert.equal(presentation.removedPageMarkers, 7);
  assert.ok(text.includes('الجملة رقم 00') && text.includes('الجملة رقم 613'));
});

test('رقم الصفحة المزخرف الملتصق بآخر الفقرة أو الواقف وحده يُنزع', () => {
  const raw = Array.from({ length: 6 }, (_, i) => `${filler(i)} - ${20 + i} -\n\nالفصل ${i + 1}\n\nنص الفصل ${i}`).join('\n\n');
  const { text } = reflowReading(raw);
  assert.ok(!/ - \d+ - /.test(` ${text} `) && !/(?:^|\n)- \d+ -(?:\n|$)/.test(text));
  assert.ok(text.includes('الفصل 1') && text.includes('الفصل 6'));
});

test('الترقيم المشروع في القوائم القصيرة لا يُنزع (كثافة غير صفحية)', () => {
  const raw = 'يشمل ذلك: - 1 - الأول؛ - 2 - الثاني؛ - 3 - الثالث؛ - 4 - الرابع؛ - 5 - الخامس؛ - 6 - السادس.';
  assert.equal(stripInlinePageMarkers([raw]).removed, 0);
  assert.ok(reflowReading(raw).text.includes('- 3 -'));
});

test('أرقام القرارات والتواريخ المرتبطة بشرطات داخل الكلمات لا تُمسّ', () => {
  const raw = pages(10, 7, n => `\n-\n${n}\n-\n`) + '\nالظهير الشريف رقم 232-06-1 بتاريخ 10-11-2011 مع الفقرة 1-2-3.';
  const { text } = reflowReading(raw);
  assert.ok(text.includes('232-06-1') && text.includes('10-11-2011') && text.includes('1-2-3'));
});

test('رقم الصفحة بالأرقام العربية الهندية يُنزع بالشروط نفسها', () => {
  const arabic = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
  const raw = pages(10, 7, n => `\n-\n${arabic(n)}\n-\n`);
  assert.equal(reflowReading(raw).presentation.removedPageMarkers, 7);
});

test('سلسلة أقل من خمسة أرقام لا تُنزع حذرًا', () => {
  const raw = pages(10, 4, n => `\n-\n${n}\n-\n`);
  assert.equal(reflowReading(raw).presentation.removedPageMarkers, 0);
});
