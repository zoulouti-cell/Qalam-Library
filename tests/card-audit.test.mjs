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

import { readFileSync } from 'node:fs';
test('التدقيق ظاهر في بطاقات الواجهة للمدير وحده بجانب أدوات النقل', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const tools = app.slice(app.indexOf('function adminCardTools(doc)'), app.indexOf('async function adminMonitorAction'));
  assert.ok(tools.includes("if (!state.isAdmin || doc?.origin !== 'legal-monitor'"));
  assert.ok(tools.includes('data-admin-audit=') && tools.includes('if (!state.isAdmin) return; clearTimeout(auditTimer);'));
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.ok(server.includes("p==='/api/admin/card-audit/items'") && server.includes("p==='/api/admin/card-audit/fix'"));
});

import { decisionKey, isCardKind } from '../src/card-audit.mjs';
test('القالب الموحّد يقبل «الكلمات المفتاحية» في الآخر ويحفظها عند الإصلاح', () => {
  const withKw = { ...good, summary: good.summary + '\n\nالكلمات المفتاحية:\nتنافي، شغور' };
  assert.deepEqual(auditCard(withKw), []);
  const misplaced = { ...good, summary: 'الكلمات المفتاحية:\nتنافي\n\n' + good.summary };
  assert.ok(auditCard(misplaced).some(i => i.code === 'order'));
  const fixed = fixCard(misplaced); assert.ok(fixed.trim().endsWith('الكلمات المفتاحية:\nتنافي'));
});
test('مسار الشريط (مشاريع القوانين والرقمنة) خارج تدقيق البطاقة', () => {
  assert.equal(isCardKind({ kind: 'bill' }), false); assert.equal(isCardKind({ kind: 'case_law' }), true);
  assert.deepEqual(auditCard({ kind: 'bill', title: 'Projet', summary: '' }), []);
  assert.equal(auditReport([{ _id: 'b', kind: 'bill', state: 'ready', title: 'x' }]).checked, 0);
});
test('مفتاح القرار يوحّد صيغ الرقم', () => {
  assert.equal(decisionKey({ caseNumber: '2026-1232 QPC' }), decisionKey({ officialNumber: '2026-1232QPC' }));
  assert.equal(decisionKey({ caseNumber: ' 25-17.586' }), '25-17.586');
});
test('الاستقبال يحدّث بطاقة القرار القائمة بدل إنشاء ثانية، والفحص الأسبوعي مجدول', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.ok(server.includes('if(live)item.id=live._id;'));
  assert.ok(server.includes('async function runWeeklyCardAudit') && server.includes('setInterval(()=>runWeeklyCardAudit()'));
  const wf = readFileSync(new URL('../.github/workflows/library-build.yml', import.meta.url), 'utf8');
  assert.ok(/schedule:\s*\n\s*- cron:/.test(wf) && wf.includes("if: github.event_name != 'schedule'"));
});
