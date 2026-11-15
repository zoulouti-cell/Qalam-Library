/* فهرس الاتفاقيات في Drive (محاكى): تصنيف الفرعين، عنوان الاتفاق الإقليمي الثلاثي، والبحث بالعناوين. لا يحتاج Mongo. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeDrive, ROOT_ID } from './fixtures/fake-drive.mjs';

const REGIONAL_TITLE = 'اتفاقيات إقليمية - المغرب . الجزائر. تونس. اتفاق حول التلوث البحري';
let drive, listAgreementPdfs, titles;

before(async () => {
  drive = await startFakeDrive({ sections: [] });
  Object.assign(process.env, { NODE_ENV: 'test', QALAM_TEST_GOOGLE_ORIGIN: drive.origin, GOOGLE_SERVICE_ACCOUNT_JSON: drive.serviceAccountJson, DRIVE_ROOT_FOLDER_ID: ROOT_ID });
  ({ listAgreementPdfs } = await import('../src/drive.mjs'));
  titles = (await import('node:fs')).default.readFileSync(new URL('../data/treaty-titles.json', import.meta.url), 'utf8');
  titles = JSON.parse(titles).documents;
  let seq = 0;
  const folder = (name, parent) => { const id = 'f' + (++seq); drive.files.set(id, { id, name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }); return id; };
  const pdf = (name, parent) => { const id = 'p' + (++seq); drive.files.set(id, { id, name, mimeType: 'application/pdf', parents: [parent], size: '100', modifiedTime: '2026-11-03T11:44:18.000Z' }); return id; };
  const treaties = folder('الاتفاقيات و المعاهدات', ROOT_ID), bilateral = folder('ثنائية الاطراف', treaties), multilateral = folder('متعددة الاطراف', treaties);
  const regional = folder('اتفاقيات إقليمية', multilateral), conventions = folder('اتفاقيات دولية', multilateral), tunisia = folder('تونس', bilateral);
  pdf('10038_ظهير شريف رقم 1.09.250 بنشر الاتفاق الموقع بالجزائر-1791386556569.pdf', regional);
  pdf('6652_ظهير شريف رقم 1.13.11 بنشر الاتفاق الموقع بالرباط-1739454863488.pdf', regional);
  pdf('4608_اتفاقية الأمم المتحدة في شأن النقل البحري للبضائع.pdf', conventions);
  pdf('2632_اتفاقية الاستيطان بين المغرب والجمهورية التونسية.pdf', tunisia);
});
after(async () => { if (drive) await drive.stop(); });

test('عنوان الاتفاق الإقليمي الثلاثي في فهرس العناوين كما طُلب', () => {
  assert.equal(titles['10038'].title, REGIONAL_TITLE);
  assert.match(titles['10038'].fullTitle, /التلوث البحري/);
  assert.equal(titles['10038'].country, 'اتفاقيات إقليمية');
});

test('الاتفاقيات متعددة الأطراف تُصنَّف وتُعرض بالعنوان الجديد', async () => {
  const all = await listAgreementPdfs('', 1, 2000);
  assert.equal(all.total, 4);
  assert.deepEqual(all.branches, { bilateral: 1, multilateral: 3 });
  const regional = all.files.find(file => file.name.startsWith('10038_'));
  assert.equal(regional.agreementKind, 'متعددة');
  assert.equal(regional.title, REGIONAL_TITLE);
  assert.equal(regional.country, 'اتفاقيات إقليمية');
  assert.match(regional.path, /متعددة الاطراف \/ اتفاقيات إقليمية$/);
  assert.equal(all.files.find(file => file.name.startsWith('2632_')).agreementKind, 'ثنائية');
});

test('البحث في الاتفاقيات يشمل العنوان الظاهر والعنوان الكامل لا اسم الملف وحده', async () => {
  const byMarine = await listAgreementPdfs('التلوث البحري', 1, 50);
  assert.deepEqual(byMarine.files.map(file => file.name.split('_')[0]).sort(), ['10038']);
  const byCountries = await listAgreementPdfs('الجزائر تونس', 1, 50);
  assert.ok(byCountries.files.some(file => file.name.startsWith('10038_')));
  const byNewWords = await listAgreementPdfs('اتفاقيات إقليمية', 1, 50);
  assert.ok(byNewWords.files.some(file => file.name.startsWith('10038_')));
  assert.equal((await listAgreementPdfs('لا يوجد مثل هذا العنوان أبدا', 1, 50)).total, 0);
});

test('النصوص المضمنة تُربط بملفاتها وتُعرض في موضوع مجلد Drive الصحيح', async () => {
  const all = await listAgreementPdfs('', 1, 2000);
  const byPrefix = prefix => all.files.find(file => file.name.startsWith(prefix + '_'));
  assert.equal(byPrefix('10038').textDocumentId, 'agreement-10038');
  assert.equal(byPrefix('10038').textOrder, 1);
  assert.equal(byPrefix('10038').agreementSubcategory, 'اتفاقيات إقليمية');
  assert.equal(byPrefix('6652').textDocumentId, 'agreement-6652');
  assert.equal(byPrefix('6652').textOrder, 2);
  assert.equal(byPrefix('4608').textDocumentId, 'agreement-4608');
  assert.ok(byPrefix('4608').textOrder > 0);
  assert.equal(byPrefix('4608').agreementSubcategory, 'اتفاقيات دولية');
  assert.ok(!byPrefix('2632').textDocumentId, 'الوثيقة الثنائية لا تُدرج في سجل النصوص متعددة الأطراف');
});
