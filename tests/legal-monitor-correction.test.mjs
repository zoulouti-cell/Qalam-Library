/* تصحيح قرار قضائي: وصول القرار نفسه (المصدر والمحكمة والتاريخ) برقم مصحَّح يسحب البطاقة القديمة الخاطئة. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, sessionCookie } from './fixtures/boot-server.mjs';

const MONGO = process.env.QALAM_TEST_MONGODB_URI;
const skip = MONGO ? false : 'QALAM_TEST_MONGODB_URI غير مضبوط';
let server; const getServer = async () => server || (server = await bootServer({ env: { QALAM_TRUST_PROXY: '1' } }));
after(async () => { if (server) await server.stop().catch(() => {}); });
const admin = sessionCookie('admin');
let ip = 0;
async function send(body) {
  const response = await fetch((await getServer()).base + '/api/admin/legal-monitor/items', { method: 'POST', headers: { 'content-type': 'application/json', cookie: admin, 'x-forwarded-for': `10.40.0.${++ip}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const card = (caseNumber, extra = {}) => ({
  country: 'fr', kind: 'case_law', court: 'Cour de cassation', caseNumber, officialNumber: caseNumber, eventDate: '2026-11-12',
  title: `مبدأ في الطعن ${caseNumber}`, originalTitle: 'Pourvoi',
  summary: 'الجهة والمراجع: محكمة النقض.\nالملخص: ملخص كاف لاجتياز حد الطول الأدنى للبطاقة.\nما الجديد: لا شيء.\nالأثر العملي: لا شيء.\nالأصل: الرابط الرسمي.',
  source: { url: 'https://www.courdecassation.fr/decision/6afd717b6c2e177812d50904', label: 'Judilibre', official: true, verified: true }, complete: true, ...extra,
});
const items = async () => (await getServer()).mongo(db => db.collection('legalMonitorItems').find({}).toArray());

test('بطاقة نقض بمصدرها نفسه ورقم مصحَّح تسحب القديمة الخاطئة وتبقى شاهد حذف', { skip }, async () => {
  const wrong = await send(card('25-00.000'));
  assert.equal(wrong.status, 201);
  const right = await send(card('25-18.695'));
  assert.equal(right.status, 201); assert.notEqual(right.body.id, wrong.body.id);
  const rows = await items();
  assert.equal(rows.find(r => r._id === wrong.body.id).state, 'dismissed');
  assert.equal(rows.find(r => r._id === right.body.id).state, 'ready');
  assert.equal((await send(card('25-00.000'))).body.skipped, true, 'الخاطئة المسحوبة لا تعود');
});

test('قرارات مختلفة في اليوم نفسه بمصدرين مختلفين لا يمسّ بعضها بعضاً', { skip }, async () => {
  const a = await send(card('25-11.111', { eventDate: '2026-11-13', source: { url: 'https://www.courdecassation.fr/decision/aaa', label: 'Judilibre', official: true, verified: true } }));
  const b = await send(card('25-22.222', { eventDate: '2026-11-13', source: { url: 'https://www.courdecassation.fr/decision/bbb', label: 'Judilibre', official: true, verified: true } }));
  const rows = await items();
  assert.equal(rows.find(r => r._id === a.body.id).state, 'ready');
  assert.equal(rows.find(r => r._id === b.body.id).state, 'ready');
});
