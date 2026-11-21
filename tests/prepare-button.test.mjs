/* زر «تهيئة»: يتحقق من مفتاح Gemini ويرفض غير PDF قبل أي جلب، ويظهر في الواجهة عند نقص النص فقط. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
const block = server.slice(server.indexOf("action==='prepare'"), server.indexOf("action==='category'"));

test('إجراء التهيئة يفحص المفتاح قبل الجلب ولا يحفظ نصاً قصيراً', () => {
  assert.ok(block.indexOf("code:'no_key'") > 0);
  assert.ok(block.indexOf("code:'no_key'") < block.indexOf('fetchOfficialPdf'));
  assert.match(block, /clean\.length<200/);
  assert.match(block, /finally\{activeDriveOcr=false;\}/);
});

test('الزر يظهر فقط حين ينقص النص ويوجد مصدر', () => {
  assert.match(admin, /r\.text\.state!=='ok'&&r\.original\.state!=='missing'/);
  assert.match(admin, /action:'prepare'/);
});
