/* نصوص الاتفاقيات متعددة الأطراف المضمنة في المكتبة. تُدمج في الفهرس وتظهر في نافذة الاطلاع، وترتبط بأصول Drive بمعرف الملف. */
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const AGREEMENT_SECTION = 'اتفاقيات إقليمية';
const file = fileURLToPath(new URL('../data/agreement-texts.json.gz', import.meta.url));
let records = [];
try {
  const payload = gunzipSync(fs.readFileSync(file)).toString('utf8');
  records = (JSON.parse(payload).documents || []).filter(d => d && d.documentId && d.treatyId && d.text);
} catch (error) {
  console.error('Bundled agreement texts unavailable:', error.message);
}

export const bundledAgreementTexts = Object.freeze(records.map(d => Object.freeze({ ...d })));
const byTreaty = new Map(bundledAgreementTexts.map(d => [String(d.treatyId), d]));
export function agreementTextFor(treatyId) { return byTreaty.get(String(treatyId || '')) || null; }
