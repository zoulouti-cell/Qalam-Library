import { titleNeedsArabic, publicationCategory } from './legal-monitoring.mjs';

/* تدقيق البطاقة الموحّدة: يمرّ على كل بطاقات المستجدات (إضافات النقض، القسم الفرنسي، مقترحات القوانين وتعديلاتها،
   المحكمة الدستورية، سائر المستجدات) ويفحص التزامها بالقالب. الإصلاح التلقائي يقتصر على ما لا يحتاج كتابة محتوى. */
export const HEADINGS = ['الجهة والمراجع:', 'الملخص:', 'ما الجديد:', 'الأثر العملي:', 'الأصل:'];
const TECH = /\b(curl|firecrawl|webfetch|websearch|playwright|http\s*40[34])\b|مستخرج\s+آلياً|استُخرج\s+النص\s+بواسطة|يُراجَع\s+النص\s+الأصلي|يراجع\s+النص\s+الأصلي|حجب\s+الموقع/i;
const ARABIC = /[؀-ۿ]/;
const HONEST_MISSING = 'الأصل غير متاح للتنزيل؛ الرابط الرسمي أعلاه';

const hasDriveOriginal = item => [item.original, ...(Array.isArray(item.originals) ? item.originals : [])].some(o => o?.driveId);
const norm = s => String(s || '').replace(/[\s‏‎]+/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).toLowerCase();

/* يقسم الملخص إلى أقسامه بحسب العناوين الخمسة؛ ما قبل أول عنوان يبقى مقدمة. */
export function splitSections(summary = '') {
  const text = String(summary || '');
  const marks = [];
  for (const h of HEADINGS) { const i = text.indexOf(h); if (i > -1) marks.push({ h, i }); }
  marks.sort((a, b) => a.i - b.i);
  const sections = {};
  marks.forEach((m, k) => { sections[m.h] = text.slice(m.i + m.h.length, k + 1 < marks.length ? marks[k + 1].i : text.length).trim(); });
  return { sections, order: marks.map(m => m.h), lead: marks.length ? text.slice(0, marks[0].i).trim() : text.trim() };
}

export function auditCard(item = {}) {
  const issues = [];
  const add = (code, label, fixable = false) => issues.push({ code, label, fixable });
  if (titleNeedsArabic(item) || !ARABIC.test(item.title || '')) add('title', 'العنوان غير معرَّب');
  if (!ARABIC.test(item.source?.label || '')) add('source', 'بيان المصدر ليس بالعربية');
  if (!/^https:\/\//.test(item.source?.url || '')) add('url', 'لا رابط رسمي https مباشر');
  const { sections, order } = splitSections(item.summary);
  const missing = HEADINGS.filter(h => !(h in sections));
  if (missing.length) add('headings', 'عناوين ناقصة: ' + missing.map(h => h.replace(':', '')).join('، '));
  else if (order.join('|') !== HEADINGS.join('|')) add('order', 'ترتيب العناوين مخالف للقالب', true);
  if (TECH.test(item.summary || '')) add('tech', 'ملاحظات تقنية أو عبارات «مستخرج آلياً» في المتن', true);
  const origin = sections['الأصل:'] || '';
  if (origin && /(مرفوعة|محفوظ)\s+في\s+Drive/.test(origin) && !hasDriveOriginal(item)) add('origin', 'سطر «الأصل» يدّعي ملفاً في Drive غير موجود', true);
  return issues;
}

/* الإصلاح الآمن: إعادة ترتيب الأقسام، وحذف الجمل التقنية، وتصحيح سطر «الأصل» الكاذب. لا يُكتب محتوى جديد. */
export function fixCard(item = {}) {
  const { sections, lead } = splitSections(item.summary);
  if (HEADINGS.some(h => !(h in sections))) return null;
  const clean = s => s.split(/(?<=[.؛\n])\s*/).filter(part => !TECH.test(part)).join(' ').replace(/[ \t]+/g, ' ').trim();
  const out = {};
  for (const h of HEADINGS) out[h] = clean(sections[h]);
  if (/(مرفوعة|محفوظ)\s+في\s+Drive/.test(out['الأصل:']) && !hasDriveOriginal(item)) out['الأصل:'] = HONEST_MISSING;
  if (!out['الأصل:']) out['الأصل:'] = hasDriveOriginal(item) ? 'نسخة الأصل محفوظة في Drive' : HONEST_MISSING;
  const summary = [lead && !TECH.test(lead) ? lead : '', ...HEADINGS.map(h => h + '\n' + out[h])].filter(Boolean).join('\n\n');
  return summary === String(item.summary || '') ? null : summary;
}

/* التكرار: القرار أو النص نفسه (البلد والنوع والرقم الرسمي أو رقم القضية) في أكثر من بطاقة حيّة. */
export function findDuplicates(items = []) {
  const groups = new Map();
  for (const it of items) {
    if (it.state === 'dismissed') continue;
    const num = norm(it.officialNumber || it.caseNumber).replace(/(qpc|dc|ل\.?)$/i, '');
    if (!num || num.length < 3) continue;
    const key = [it.country, it.kind === 'bill' ? 'legislation' : it.kind, num].join('|');
    (groups.get(key) || groups.set(key, []).get(key)).push(it);
  }
  return [...groups.values()].filter(g => g.length > 1).map(g => g.map(it => ({ id: it._id || it.id, title: it.title, state: it.state })));
}

export function auditReport(items = []) {
  const live = items.filter(it => it.state !== 'dismissed');
  const cards = live.map(it => ({ id: it._id || it.id, title: it.title, state: it.state, category: publicationCategory(it), issues: auditCard(it) })).filter(c => c.issues.length);
  const byCategory = {};
  for (const it of live) { const c = publicationCategory(it); byCategory[c] = byCategory[c] || { total: 0, faulty: 0 }; byCategory[c].total++; }
  for (const c of cards) byCategory[c.category].faulty++;
  return { checked: live.length, faulty: cards.length, fixable: cards.filter(c => c.issues.some(i => i.fixable)).length, byCategory, cards, duplicates: findDuplicates(live) };
}
