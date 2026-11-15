/* نصوص اتفاقيات مضمّنة في المكتبة (data/agreement-texts.json): تُدمج في الفهرس كوثائق منشورة
   فتظهر في البحث والفئات وتُفتح في نافذة الاطلاع كباقي المكتبة، من غير حاجة إلى قاعدة الإدارة.
   ترتبط كل وثيقة ببطاقة الاتفاق في Drive عبر الرقم الرقمي الذي يبدأ به اسم الملف (treatyId). */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const AGREEMENT_SECTION = 'اتفاقيات إقليمية';
const file = fileURLToPath(new URL('../data/agreement-texts.json', import.meta.url));
let records = [];
try { records = (JSON.parse(fs.readFileSync(file, 'utf8')).documents || []).filter(d => d && d.documentId && d.treatyId && d.text); }
catch { console.error('Bundled agreement texts unavailable.'); }

export const bundledAgreementTexts = Object.freeze(records.map(d => Object.freeze({ ...d })));
const byTreaty = new Map(bundledAgreementTexts.map(d => [String(d.treatyId), d]));
export function agreementTextFor(treatyId) { return byTreaty.get(String(treatyId || '')) || null; }
