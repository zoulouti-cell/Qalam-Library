/* تعديلات المدير على الاتفاقيات: النقل بين الفروع والإخفاء يظهران في الفهرس فعلًا، والاسترداد يعيد الأصل. لا يحتاج Mongo. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeDrive, ROOT_ID } from './fixtures/fake-drive.mjs';

let drive, listAgreementPdfs, setAgreementOverrides;
before(async () => {
  drive = await startFakeDrive({ sections: [] });
  Object.assign(process.env, { NODE_ENV: 'test', QALAM_TEST_GOOGLE_ORIGIN: drive.origin, GOOGLE_SERVICE_ACCOUNT_JSON: drive.serviceAccountJson, DRIVE_ROOT_FOLDER_ID: ROOT_ID });
  ({ listAgreementPdfs, setAgreementOverrides } = await import('../src/drive.mjs'));
  let seq = 0;
  const folder = (name, parent) => { const id = 'f' + (++seq); drive.files.set(id, { id, name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }); return id; };
  const pdf = (name, parent) => { const id = 'p' + (++seq); drive.files.set(id, { id, name, mimeType: 'application/pdf', parents: [parent], size: '100', modifiedTime: '2026-11-03T11:44:18.000Z' }); return id; };
  const treaties = folder('الاتفاقيات و المعاهدات', ROOT_ID), bilateral = folder('ثنائية الاطراف', treaties), multilateral = folder('متعددة الاطراف', treaties);
  pdf('10038_ظهير شريف رقم 1.09.250 بنشر الاتفاق الموقع بالجزائر-1791386556569.pdf', folder('اتفاقيات إقليمية', multilateral));
  pdf('2632_اتفاقية الاستيطان بين المغرب والجمهورية التونسية.pdf', folder('تونس', bilateral));
});
after(async () => { setAgreementOverrides([]); if (drive) await drive.stop(); });

const find = async id => (await listAgreementPdfs('', 1, 2000)).files.find(f => String(f.treatyId) === id);

test('النقل يغيّر الفرع والمجلد في الفهرس، والاسترداد يعيد الأصل', async () => {
  const original = await find('2632');
  assert.ok(original, 'الاتفاقية في الفهرس'); assert.equal(original.agreementKind, 'ثنائية');
  setAgreementOverrides([{ treatyId: '2632', kind: 'متعددة', group: 'اتفاقيات دولية', hidden: false }]);
  const moved = await find('2632');
  assert.equal(moved.agreementKind, 'متعددة'); assert.equal(moved.agreementSubcategory, 'اتفاقيات دولية');
  assert.match(moved.path, /متعددة الأطراف \/ اتفاقيات دولية$/);
  const list = await listAgreementPdfs('', 1, 2000);
  assert.equal(list.branches.multilateral >= 2, true, 'العدّادات تتبع النقل');
  setAgreementOverrides([]);
  assert.equal((await find('2632')).agreementKind, 'ثنائية');
});

test('الإخفاء يُسقط الاتفاقية من الفهرس والعدّادات ويُستردّ', async () => {
  const before = (await listAgreementPdfs('', 1, 2000)).total;
  setAgreementOverrides([{ treatyId: '10038', hidden: true }]);
  assert.equal(await find('10038'), undefined);
  assert.equal((await listAgreementPdfs('', 1, 2000)).total, before - 1);
  setAgreementOverrides([]);
  assert.ok(await find('10038'));
});
