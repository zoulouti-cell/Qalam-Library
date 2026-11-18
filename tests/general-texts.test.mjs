import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERAL_TEXTS, catalogCategory, orderedCategories, withGeneralTexts } from '../src/catalog.mjs';

const row = (name, count = 1) => ({ name, count, legislationCount: count, jurisprudenceCount: 0, studiesCount: 0 });

test('«المادة الدستورية» تسبق القوانين الوطنية وتضم الدساتير ثم المحكمة الدستورية', () => {
  const list = orderedCategories([row('المادة المدنية'), row('القضاء الدستوري'), row('الدساتير')]);
  assert.deepEqual(list.slice(0, 2).map(item => item.name), ['الدساتير', 'القضاء الدستوري']);
  assert.ok(list.slice(0, 2).every(item => item.group === 'constitutional' && item.groupLabel === 'المادة الدستورية'));
  assert.equal(list[2].group, 'materials');
});

test('التصنيف المؤسسي يضع كل مؤسسة عامة باسمها ويستبعد الهيئات المهنية', () => {
  assert.equal(catalogCategory({ type: 'judicial', category: 'محكمة النقض', title: 'قرار المحكمة الدستورية' }), 'القضاء الدستوري');
  assert.equal(catalogCategory({ type: 'national', category: 'المادة الدستورية', title: 'قانون ممارسة الحق في الإضراب' }), 'مادة الحقوق والحريات');
  assert.equal(catalogCategory({ type: 'national', category: 'المادة الإدارية', title: 'قانون يتعلق بمجلس المنافسة' }), 'مجلس المنافسة');
  assert.equal(catalogCategory({ type: 'national', category: 'المادة الإدارية', title: 'قانون بإحداث الوكالة الوطنية للمياه والغابات' }), 'الوكالة الوطنية للمياه والغابات');
  assert.equal(catalogCategory({ type: 'national', category: 'مادة المهن', title: 'نظام هيئة مهنية' }), 'مادة المهن');
  assert.equal(catalogCategory({ type: 'national', category: 'مجلس الوصاية', title: '90.15 — مجلس الوصاية' }), 'مجلس الوصاية');
  assert.equal(catalogCategory({ type: 'national', category: 'مادة حماية حقوق الإنسان والنهوض بها', title: '14.16 — مؤسسة الوسيط' }), 'مؤسسة الوسيط');
  assert.equal(catalogCategory({ type: 'national', category: 'السلطة القضائية', title: '100.13 — المجلس الأعلى للسلطة القضائية' }), 'السلطة القضائية');
});

test('«نصوص عامة» تُضاف فارغة في آخر القوانين الوطنية قبل السلطات', () => {
  const list = withGeneralTexts(orderedCategories([row('المادة المدنية', 5), row('مادة الفلاحة', 2), row('السلطة التنفيذية', 3), row('محكمة النقض', 4), row('دراسات قانونية', 1)]));
  const names = list.map(c => c.name);
  const at = names.indexOf(GENERAL_TEXTS);
  assert.ok(at > 0);
  assert.equal(list[at].count, 0);
  assert.equal(list[at].group, 'materials');
  assert.equal(list[at].groupLabel, 'القوانين الوطنية');
  assert.equal(list[at - 1].group, 'materials');
  assert.equal(list[at + 1].name, 'السلطة التنفيذية');
});

test('إن وُجدت فيها وثائق تُثبَّت آخر المجموعة بعددها ولا تتكرر', () => {
  const list = withGeneralTexts(orderedCategories([row('نصوص عامة', 99), row('المادة المدنية', 5), row('مادة الفلاحة', 2)]));
  assert.equal(list.filter(c => c.name === GENERAL_TEXTS).length, 1);
  const at = list.findIndex(c => c.name === GENERAL_TEXTS);
  assert.equal(list[at].count, 99);
  assert.equal(at, list.length - 1);
});

test('الفئة المضافة من لوحة الإدارة بلا مجموعة تنتقل إلى مجموعتها', () => {
  const list = withGeneralTexts([...orderedCategories([row('المادة المدنية', 5), row('محكمة النقض', 4)]), row('نصوص عامة', 2)]);
  const at = list.findIndex(c => c.name === GENERAL_TEXTS);
  assert.equal(list[at].group, 'materials');
  assert.equal(list[at - 1].name, 'المادة المدنية');
});
