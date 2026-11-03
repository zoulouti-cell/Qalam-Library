export function normalizeSearch(value = '') {
  return String(value).normalize('NFKC').toLowerCase()
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/[ىی]/g, 'ي').replace(/ک/g, 'ك')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0));
}
export const tokens = value => normalizeSearch(value).match(/[\p{L}\p{N}]+/gu) || [];
export const STOP = new Set(tokens('ما ماذا كيف هل هو هي في من على إلى عن مع هذا هذه ذلك التي الذي هل متى أين لماذا أريد اشرح لي وما وماهي ماهي قانون القانون القوانين المغربي المغربية المغرب سؤال جواب يمكن يكون تكون النص النصوص المتاحة المتوفر المتوفرة حول بخصوص بشأن اعطني أعطني وضح توضيح شرح معلومات ابحث بحث تفصيل تفاصيل تحليل مساعدة ساعدني فضلك رجاء قانونية قانوني القانونية القانوني'));
export const meaningfulTokens = value => [...new Set(tokens(value).filter(t => t.length > 1 && !STOP.has(t)))].slice(0, 12);
export const labels = { national: 'نص تشريعي', judicial: 'محتوى قضائي', juriscassation: 'قرار قضائي' };
const PRIMARY_LAW_REFERENCES=['المسطرة المدنية','المسطرة الجنائية','الالتزامات والعقود','مجموعة القانون الجنائي','القانون الجنائي','مدونة التجارة','مدونة الأسرة','مدونة الشغل','مدونة الحقوق العينية','التحفيظ العقاري','مدونة السير','03.01','55.19','54.19','54.05'].map(normalizeSearch);
export function kindOf(d) {
  if (d.type === 'juriscassation') return 'decision';
  if (d.type === 'judicial') return /دراسات|تقارير|تقرير|مقالات|نشرة|مجلة|أبحاث|ابحاث|بحوث/.test(d.category) ? 'study' : 'jurisprudence';
  const title=normalizeSearch(d.title).trim().replace(/^تم\s+نسخ\s+/,'').replace(/^ال(?=ظهير|مرسوم|قرار)/,'');
  if(d.type==='national'&&((d.law_number&&PRIMARY_LAW_REFERENCES.some(reference=>title.includes(reference)))||title==='الالتزامات والعقود'))return 'law';
  if(/^(?:القانون|قانون|مدونه|مدونة|دستور|مجموعة القانون)/.test(title))return 'law';
  // Classify the governing instrument, not a law cited in its subject.
  const lead=title.split(/(?:المتعلق|المتعلقه|يتعلق)\s+ب(?!تنفيذ)|بشان|بمنع|باحداث|بتحديد|بتطبيق|لتطبيق|بتغيير|بتتميم/)[0];
  if(/^مرسوم/.test(title))return /بمثابة\s+(?:قانون|مدونة)|^مرسوم[\s-]+قانون/.test(lead)?'law':'decree';
  if(/^ظهير/.test(title))return /بمثابة\s+(?:قانون|مدونة)|بسن\s+قانون|تنفيذ\s+(?:نص\s+)?(?:ال)?قانون|(?:ب)?المصادقة\s+عل[ىي]\s+(?:مجموعة\s+)?(?:ال)?قانون|تنفيذ\s+نص\s+الدستور/.test(lead)?'law':'dahir';
  if(/^قرار/.test(title))return 'order';
  return 'other';
}
export function preserveJudicialCard(d, quality = {}) {
  return ['decision','jurisprudence'].includes(kindOf(d)) && ['juriscassation','judicial'].includes(d.type) && quality.text_kind !== 'extracted_text';
}
export function lawNumber(title, text = '') {
  // Legacy callers receive only an explicit primary law number in the title.
  const normalized=normalizeSearch(title).replace(/^تم\s+نسخ\s+/,'');
  const segment=normalized.replace(/^ظهير[\s\S]*?(?:بتنفيذ|بتنفيذ\s+نص|بسن)\s+/,'');
  return segment.match(/^(?:ال)?قانون(?:\s*[–-]?\s*(?:التنظيمي|تنظيمي|الاطار|اطار))?\s+(?:رقم\s*)?(\d+(?:[.\/-]\d+)*)/)?.[1]||'';
}
const ordinal = new Map(Object.entries({ 'الأولى':1,'الأول':1,'الثانية':2,'الثاني':2,'الثالثة':3,'الثالث':3,'الرابعة':4,'الرابع':4,'الخامسة':5,'الخامس':5,'السادسة':6,'السادس':6,'السابعة':7,'السابع':7,'الثامنة':8,'الثامن':8,'التاسعة':9,'التاسع':9,'العاشرة':10,'العاشر':10 }).map(([k,v]) => [normalizeSearch(k), v]));
export function headingsOf(text) {
  const rx = /^(?:[ \t]*)(المادة|الفصل|الباب|القسم|الكتاب|الجزء|الفرع|الملحق|الديباجة|البند)[ \t]+([^\n]{1,160})/gm;
  const out = [];
  for (const match of text.matchAll(rx)) {
    const tail = match[2].trim();
    if (/^(?:\d+)\s+من\s+(?:القانون|هذا|الظهير|المرسوم|المدونة)/.test(tail)) continue;
    const first = tail.split(/\s|[:،]/)[0];
    const n = normalizeSearch(first);
    const number = /^\d+(?:[.\/-]\d+)*$/.test(n) ? n : ordinal.has(n) ? String(ordinal.get(n)) : '';
    const start=match.index+match[0].indexOf(match[1]);
    out.push({key: String(start),marker:match[1],label:match[0].trim().slice(0,160),number,start,end:text.length});
  }
  for(const match of text.matchAll(/^[ \t]*(الديباجة|تصدير)[ \t]*$/gm)){const start=match.index+match[0].indexOf(match[1]);if(!out.some(h=>h.start===start))out.push({key:String(start),marker:match[1],label:match[1],number:'',start,end:text.length});}
  out.sort((a,b)=>a.start-b.start);
  for (let i=0;i<out.length-1;i++) out[i].end=out[i+1].start;
  return out;
}
export function snippet(text, query, length=260) {
  if (!text) return '';
  const norm = normalizeSearch(text);
  let start = Infinity;
  for (const term of meaningfulTokens(query)) {
    const i=norm.indexOf(term); if(i>=0) start=Math.min(start,i);
  }
  if (!Number.isFinite(start)) start=0;
  start=Math.max(0,start-75);
  return (start?'…':'') + text.slice(start,start+length).replace(/\s+/g,' ').trim() + (start+length<text.length?'…':'');
}
export function citationOf(d) {
  return [d.title, d.type==='juriscassation'&&d.decision_number ? 'قرار رقم '+d.decision_number : '', d.type==='juriscassation'&&d.case_number ? 'ملف '+d.case_number : '', d.date, d.source_label, 'معرّف قلم: '+d.id].filter(Boolean).join('، ');
}
export function isAnswerReady(d) {
  const issues=Array.isArray(d.issues)?d.issues:JSON.parse(d.issues||'[]');
  return d.text_kind === 'extracted_text' && !issues.some(x=>['encoding_suspected','mixed_glyphs','unreadable_encoding','no_readable_text','ambiguous_source','possible_missing_content','manual_review_incomplete','pdf_error','ocr_unverified','ocr_sensitive_tokens_require_review'].includes(x));
}
export const RELATED = [
  ['الطلاق|التطليق|النفقة|الحضانة|الزواج',['مدونة الأسرة','التطليق','النفقة','الحضانة','الزواج']],['الإرث|التركة|الوصية',['مدونة الأسرة','الإرث','التركة','الوصية']],
  ['الشغل|شغل|العمل|الطرد|الأجير',['مدونة الشغل','عقد الشغل','حوادث الشغل','الفصل التعسفي','الأجير','التعويض عن الفصل']],
  ['التحفيظ|العقار|الملكية',['الحقوق العينية','التحفيظ العقاري','التعرض','الحيازة','الرهن العقاري']],
  ['الجريمة|جنائي|جنائية|العقوبات',['القانون الجنائي','المسطرة الجنائية','العقوبات','التقادم الجنائي']],['اعتقال|السراح|الحراسة النظرية',['الاعتقال الاحتياطي','السراح المؤقت','الحراسة النظرية']],
  ['النقض|محكمة النقض|الطعن بالنقض',['وسائل النقض','التعليل','قبول الطعن','اجتهادات محكمة النقض']],['التنفيذ|الحجز',['التنفيذ الجبري','المسطرة المدنية','صعوبات التنفيذ']],
  ['الشركات|شركة|التاجر|الأصل التجاري',['مدونة التجارة','الشركات التجارية','صعوبات المقاولة','التصفية القضائية']],['شيك|الكمبيالة|الأوراق التجارية',['المادة التجارية','الكمبيالة','الشيك']],
  ['الإثبات|حجية|الشهادة|الخبرة|القرائن|الإقرار',['حجية المحررات','الشهادة','الخبرة القضائية','القرائن','الإقرار']],['المسؤولية|تعويض|الضرر',['المسؤولية المدنية','الضرر','الخطأ المرفقي','التعويض عن الضرر']],
  ['عقد|العقود|الالتزامات',['الالتزامات والعقود','فسخ العقد','تنفيذ العقد','بطلان العقد']],['كراء|الإيجار|إفراغ',['الكراء التجاري','إفراغ المكترِي','الإنذار بالإفراغ']],
  ['إداري|إدارية|الإلغاء|الشطط',['القرار الإداري','دعوى الإلغاء','الشطط في استعمال السلطة','المحاكم الإدارية']],['تأديب|الموظف العمومي|الوظيفة العمومية',['الوظيفة العمومية','العقوبة التأديبية','الموظف العمومي']],
  ['ضريبة|ضرائب|الجبايات',['المنازعات الضريبية','التحصيل الجبري','الجبايات المحلية']],['دستوري|دستورية|الدستور',['المحكمة الدستورية','الحقوق والحريات','القانون التنظيمي']],
  ['استهلاك|المستهلك',['حماية المستهلك','البيع الاستهلاكي','العيب الخفي']],['تأمين|حوادث السير',['عقد التأمين','التعويض عن حوادث السير','المسؤولية المدنية']],
  ['عنف|المرأة|الاتجار بالبشر',['العنف الأسري','حماية النساء','الاتجار بالبشر']],['انتخابات|الانتخاب',['المنازعات الانتخابية','اللوائح الانتخابية','القانون التنظيمي للانتخابات']],
].map(([keys,values])=>[keys.split('|').map(normalizeSearch),values]);
export function relatedQueries(q,scope='all') {
  const norm=normalizeSearch(q),terms=tokens(norm);if(!norm||!terms.length)return [];
  const out=[];for(const [keys,values] of RELATED)if(keys.some(key=>norm.includes(key)||terms.includes(key)||terms.includes(key.replace(/^ال/,''))))out.push(...values);
  const filtered=[...new Set(out)].filter(v=>normalizeSearch(v)!==norm);
  return filtered.slice(0,8);
}
export function isAnnualFinanceLaw(d) {
  if(d.type!=='national')return false;
  const title=normalizeSearch(d.title).trim();
  return /(?:^|بتنفيذ\s+)قانون\s+(?:المالية|التصفية)(?:\s|$)/u.test(title);
}

