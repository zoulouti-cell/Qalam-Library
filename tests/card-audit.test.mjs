import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCard, fixCard, findDuplicates, auditReport, splitSections } from '../src/card-audit.mjs';

const good = { title: 'شغور مقعد', country: 'ma', kind: 'case_law', court: 'المحكمة الدستورية', state: 'ready', source: { url: 'https://x.ma/d', label: 'المحكمة الدستورية' },
  summary: 'الجهة والمراجع:\nأ\n\nالملخص:\nب\n\nما الجديد:\nج\n\nالأثر العملي:\nد\n\nالأصل:\nالأصل غير متاح للتنزيل؛ الرابط الرسمي أعلاه' };

test('البطاقة المطابقة لا مخالفات فيها', () => { assert.deepEqual(auditCard(good), []); assert.equal(fixCard(good), null); });

test('يكشف العنوان الفرنسي والمصدر غير العربي والعناوين الناقصة', () => {
  const codes = auditCard({ ...good, country: 'fr', title: 'Cour de cassation', source: { url: 'https://x', label: 'Cour' }, summary: 'الملخص:\nب' }).map(i => i.code);
  assert.ok(codes.includes('title') && codes.includes('source') && codes.includes('headings'));
});

test('الإصلاح الآمن يرتّب الأقسام ويحذف الملاحظة التقنية ويصحح «الأصل» الكاذب دون اختراع محتوى', () => {
  const bad = { ...good, summary: 'الملخص:\nب. ملخص مستخرج آلياً من الصفحة.\n\nالجهة والمراجع:\nأ\n\nما الجديد:\nج\n\nالأثر العملي:\nد\n\nالأصل:\nنسخة PDF مرفوعة في Drive' };
  const codes = auditCard(bad).map(i => i.code);
  assert.ok(codes.includes('order') && codes.includes('tech') && codes.includes('origin'));
  const fixed = fixCard(bad), { order, sections } = splitSections(fixed);
  assert.deepEqual(order, ['الجهة والمراجع:', 'الملخص:', 'ما الجديد:', 'الأثر العملي:', 'الأصل:']);
  assert.ok(!/مستخرج آلياً/.test(fixed)); assert.equal(sections['الملخص:'], 'ب.');
  assert.equal(sections['الأصل:'], 'الأصل غير متاح للتنزيل؛ الرابط الرسمي أعلاه');
  assert.deepEqual(auditCard({ ...bad, summary: fixed }), []);
});

test('لا يُصلح ما ينقصه قسم (يحتاج كتابة)', () => { assert.equal(fixCard({ ...good, summary: 'الملخص:\nب' }), null); });

test('يكشف تكرار القرار نفسه ويتجاهل المحذوف', () => {
  const items = [{ _id: 'a', country: 'fr', kind: 'case_law', caseNumber: '2026-1232 QPC', state: 'published', title: 'أ' }, { _id: 'b', country: 'fr', kind: 'case_law', caseNumber: '2026-1232QPC', state: 'ready', title: 'ب' }, { _id: 'c', country: 'fr', kind: 'case_law', caseNumber: '2026-1232 QPC', state: 'dismissed', title: 'ج' }];
  const d = findDuplicates(items); assert.equal(d.length, 1); assert.equal(d[0].length, 2);
  const r = auditReport(items); assert.equal(r.checked, 2);
});
