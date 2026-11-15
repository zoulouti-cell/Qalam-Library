/* اختبارات سجل نصوص الاتفاقيات متعددة الأطراف، مواضعها في التصفح والبحث، والربط بالأصول. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { makeLibraryDb } from './fixtures/make-library-db.mjs';
import { bundledAgreementTexts, agreementTextFor, AGREEMENT_SECTION } from '../src/agreement-texts.mjs';
import { Library } from '../src/library.mjs';
import { headingsOf } from '../src/text.mjs';
import { reflowReading } from '../src/reading.mjs';

let dir, library;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-agr-'));
  library = new Library(makeLibraryDb(path.join(dir, 'library.sqlite')));
  library.setBundledContent(bundledAgreementTexts);
});
after(() => { try { library?.db.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
const byId = id => bundledAgreementTexts.find(d => String(d.treatyId) === String(id));
const MARINE = byId('10038'), BANK = byId('6652'), HAMBURG = byId('4608'), SOLAS = byId('7692');

test('فهرس الاتفاقيات يضم الأصول متعددة الأطراف كلها دون إدخال ملفات الفرع الثنائي', () => {
  assert.equal(bundledAgreementTexts.length, 167);
  assert.equal(new Set(bundledAgreementTexts.map(d => String(d.treatyId))).size, 167);
  const multilateral = bundledAgreementTexts.filter(d => d.category === 'اتفاقيات ومعاهدات');
  assert.equal(multilateral.length, 165);
  assert.deepEqual(Object.fromEntries([...new Set(multilateral.map(d => d.subcategory))].sort().map(n => [n, multilateral.filter(d => d.subcategory === n).length])), {
    'اتفاقيات إقليمية': 38, 'اتفاقيات جنيف': 15, 'اتفاقيات دولية': 70, 'اتفاقيات حقوق الإنسان': 22, 'اتفاقيات لاهاي': 9, 'اتفاقيات منظمة العمل الدولية': 11,
  });
  assert.equal(AGREEMENT_SECTION, 'اتفاقيات إقليمية');
  for (const d of bundledAgreementTexts) {
    assert.equal(d.status, 'published');
    assert.match(d.originalFiles[0].driveId, /^[\w-]{20,}$/);
    assert.ok(d.originalFiles[0].name.toLowerCase().endsWith('.pdf'));
    assert.ok(d.text.length > 500);
    assert.equal(agreementTextFor(d.treatyId).documentId, d.documentId);
  }
  assert.equal(agreementTextFor('999'), null);
  assert.match(MARINE.title, /التلوث البحري/);
  assert.match(BANK.title, /البنك الإسلامي للتنمية/);
});

test('النصوص المتعددة الأطراف تظهر كاملة في القراءة والبحث مع أصل Drive', () => {
  const hamburg = library.document(HAMBURG.documentId);
  assert.equal(hamburg.title, HAMBURG.title);
  assert.ok(hamburg.text.length > 30000);
  assert.match(hamburg.text, /اتفاقية الأمم المتحدة/);
  assert.match(hamburg.text, /همبورغ/);
  assert.equal(hamburg.originalFiles[0].driveId, HAMBURG.originalFiles[0].driveId);
  const byText = library.search({ q: 'النقل البحري للبضائع' });
  assert.ok(byText.results.some(r => r.id === HAMBURG.documentId));
  const byCategory = library.search({ category: 'اتفاقيات ومعاهدات' });
  assert.ok(byCategory.total >= 165);
});

test('النصان السابقان محفوظان، ولكل منهما أصل Drive وفهرس مواد مستقر', () => {
  assert.equal(createHash('sha256').update(MARINE.text).digest('hex'), '0e05beacbc9cf56cacb8cee31341eb63b15267a77b7683aa597cb0e734d0fd96');
  assert.equal(createHash('sha256').update(BANK.text).digest('hex'), 'bf0f2e4f10001d07097753e81a85adee4f915bde91f4f04bf77c5b9a73ba022b');
  const marine = library.document(MARINE.documentId), bank = library.document(BANK.documentId);
  assert.equal(marine.headings.length, 12);
  assert.match(marine.text, /حوادث التلوث البحري/);
  assert.equal(bank.headings.length, 33);
  assert.match(bank.text, /البنك الإسلامي للتنمية/);
  for (const d of [marine, bank]) assert.ok(d.originalFiles[0].driveId);
});

test('صفحات البروتوكول المصورة أضيفت محلياً بـOCR مع تنبيه المراجعة', () => {
  const d = library.document(SOLAS.documentId);
  assert.ok(d.text.length > 70000);
  assert.match(d.sourceLabel, /OCR عربي محلي/);
  assert.notEqual(d.reviewStatus, 'human_verified');
  assert.match(d.text, /شهادة سلامة|شهادة معدات|بيانات السفينة/);
  assert.ok(headingsOf(reflowReading(d.text, {}).text).length > 0);
});

test('النصوص المضافة سليمة من رموز الاتجاه، الحروف المقلوبة، والفراغات التالفة', () => {
  for (const d of bundledAgreementTexts.filter(x => !['10038','6652'].includes(String(x.treatyId)))) {
    assert.doesNotMatch(d.text, /[‎‏‪-‮⁦-⁩]/, d.treatyId + ': رموز اتجاه متروكة');
    assert.doesNotMatch(d.text, /االتفاق|االتفاقية|الحمد هلل|�/, d.treatyId + ': عكس حرف أو محرف تالف');
    assert.doesNotMatch(d.text, /[ \t]{3,}/, d.treatyId + ': فراغ متراكم');
    assert.ok(d.text.trim().length > 500);
  }
});

test('الوثائق المنشورة في الإدارة لا تمحو النصوص المضمّنة، والمنشور بالمعرّف نفسه يتقدم عليها', () => {
  library.setManagedContent([]);
  assert.ok(library.document(MARINE.documentId));
  library.setManagedContent([{ documentId: MARINE.documentId, status: 'published', title: 'عنوان معدّل من الإدارة', category: AGREEMENT_SECTION, text: 'المادة 1\\nنص بديل.' }]);
  assert.equal(library.document(MARINE.documentId).title, 'عنوان معدّل من الإدارة');
  assert.equal(library.document(BANK.documentId).title, BANK.title);
  library.setManagedContent([]);
  assert.equal(library.document(MARINE.documentId).title, MARINE.title);
});
