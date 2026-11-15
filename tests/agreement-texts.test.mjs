/* نصوص الاتفاقيتين الإقليميتين المضمّنتين: السجل، الدمج في المكتبة (بحث/فئات/اطلاع)، صدق وسم المراجعة، سلامة النص. لا يحتاج Mongo. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
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

const MARINE = bundledAgreementTexts.find(d => d.treatyId === '10038');
const BANK = bundledAgreementTexts.find(d => d.treatyId === '6652');

test('السجل المضمّن: وثيقتان بالترتيب المطلوب وبمعرّفات Drive', () => {
  assert.equal(AGREEMENT_SECTION, 'اتفاقيات إقليمية');
  assert.deepEqual(bundledAgreementTexts.map(d => d.treatyId), ['10038', '6652']);
  assert.deepEqual(bundledAgreementTexts.map(d => d.order), [1, 2]);
  assert.equal(agreementTextFor('10038').documentId, 'agreement-10038');
  assert.equal(agreementTextFor(6652).documentId, 'agreement-6652');
  assert.equal(agreementTextFor('999'), null);
  for (const d of bundledAgreementTexts) {
    assert.equal(d.category, AGREEMENT_SECTION);
    assert.equal(d.status, 'published');
    assert.match(d.originalFiles[0].driveId, /^[\w-]{20,}$/);
    assert.ok(d.originalFiles[0].name.startsWith(d.treatyId + '_'));
  }
  assert.match(MARINE.title, /التلوث البحري/);
  assert.match(BANK.title, /البنك الإسلامي للتنمية/);
});

test('الوثيقتان تُفتحان في نافذة الاطلاع بنصهما وفهرسهما وأصلهما', () => {
  const marine = library.document('agreement-10038');
  assert.equal(marine.title, MARINE.title);
  assert.equal(marine.headings.length, 12);
  assert.match(marine.text, /حوادث التلوث البحري/);
  assert.equal(marine.originalFiles[0].driveId, MARINE.originalFiles[0].driveId);
  const bank = library.document('agreement-6652');
  assert.equal(bank.headings.length, 33);
  assert.match(bank.text, /البنك الإسلامي للتنمية/);
  assert.ok(bank.chars > 12000);
});

test('وسم المراجعة صادق: اعتماد المالك للاستخراج الآلي لا «مراجعة بشرية»', () => {
  for (const id of ['agreement-10038', 'agreement-6652']) {
    const d = library.document(id);
    assert.equal(d.reviewStatus, 'owner_approved_extraction');
    assert.notEqual(d.reviewStatus, 'human_verified');
    assert.match(d.sourceLabel, /دون مراجعة بشرية/);
    assert.match(d.citation, /ظهير شريف رقم/);
  }
});

test('البحث بالعنوان وبالفئة يجد الوثيقتين وتظهر الفئة في الأقسام', () => {
  const byTitle = library.search({ q: 'التلوث البحري' });
  assert.ok(byTitle.results.some(r => r.id === 'agreement-10038'));
  const byBank = library.search({ q: 'البنك الإسلامي للتنمية' });
  assert.ok(byBank.results.some(r => r.id === 'agreement-6652'));
  const byCategory = library.search({ category: AGREEMENT_SECTION });
  assert.deepEqual(byCategory.results.map(r => r.id).sort(), ['agreement-10038', 'agreement-6652']);
  const section = library.categories().find(c => c.name === AGREEMENT_SECTION);
  assert.ok(section);
  assert.equal(section.count, 2);
});

test('وثائق الإدارة لا تمحو المضمّنة، ووثيقة منشورة بالمعرّف نفسه تتقدّم عليها', () => {
  library.setManagedContent([]);
  assert.ok(library.document('agreement-10038'));
  library.setManagedContent([{ documentId: 'agreement-10038', status: 'published', title: 'عنوان معدّل من الإدارة', category: AGREEMENT_SECTION, text: 'المادة 1\nنص بديل.' }]);
  assert.equal(library.document('agreement-10038').title, 'عنوان معدّل من الإدارة');
  assert.equal(library.document('agreement-6652').title, BANK.title);
  library.setManagedContent([]);
  assert.equal(library.document('agreement-10038').title, MARINE.title);
});

test('سلامة النص: لا رموز اتجاه ولا عكس «لا»/«ال» ولا فراغات متراكمة', () => {
  for (const d of bundledAgreementTexts) {
    assert.doesNotMatch(d.text, /[‎‏‪-‮⁦-⁩]/, 'رموز اتجاه متروكة');
    assert.doesNotMatch(d.text, /هلل|االتفاق|االتفاقية/, 'أثر عكس «لا»/«ال»');
    assert.doesNotMatch(d.text, /�/);
    assert.doesNotMatch(d.text, /[ \t]{3,}/);
    assert.match(d.text, /المادة/);
  }
});

test('عناوين المواد بالتسلسل العددي الكامل وإعادة التنسيق لا تغيّر النص', () => {
  for (const [d, count] of [[MARINE, 12], [BANK, 33]]) {
    const once = reflowReading(d.text, {});
    const twice = reflowReading(once.text, {});
    assert.equal(twice.text, once.text);
    const numbers = headingsOf(once.text).map(h => Number(h.number)).filter(Number.isFinite);
    assert.deepEqual(numbers, Array.from({ length: count }, (_, i) => i + 1), 'تسلسل المواد ناقص أو مكرر');
  }
});
