/* نصوص الاتفاقيات متعددة الأطراف المضمنة في المكتبة. تُدمج في الفهرس وتظهر في نافذة الاطلاع، وترتبط بأصول Drive بمعرف الملف. */
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const AGREEMENT_SECTION = 'اتفاقيات إقليمية';
const file = fileURLToPath(new URL('../data/agreement-texts.json.gz', import.meta.url));
let records = [];
try {
  const payload = gunzipSync(fs.readFileSync(file)).toString('utf8');
  const tidyMultilateralText = value => String(value || '')
    .replace(/اال(?=تفاق(?:ية)?)/gu, 'ال')
    .replace(/الحمد هلل/gu, 'الحمد لله')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, '')
    .replace(/[ \t]{3,}/gu, ' ')
    .replace(/\n[ \t]+\n/gu, '\n\n')
    .replace(/\n{3,}/gu, '\n\n');
  records = (JSON.parse(payload).documents || [])
    .filter(d => d && d.documentId && d.treatyId && d.text)
    .map(d => d.category === 'اتفاقيات ومعاهدات' ? { ...d, text: tidyMultilateralText(d.text) } : d);
} catch (error) {
  console.error('Bundled agreement texts unavailable:', error.message);
}

export const bundledAgreementTexts = Object.freeze(records.map(d => Object.freeze({ ...d })));
const byTreaty = new Map(bundledAgreementTexts.map(d => [String(d.treatyId), d]));
export function agreementTextFor(treatyId) { return byTreaty.get(String(treatyId || '')) || null; }
