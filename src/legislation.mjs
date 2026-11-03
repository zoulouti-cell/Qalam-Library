import {normalizeSearch,kindOf} from './text.mjs';
const NUMBER='\\d+(?:[./-]\\d+){0,3}';
const LAW='(?:ال)?قانون(?:\\s*[–-]?\\s*(?:التنظيمي|تنظيمي|الاطار|اطار))?';
const digits=s=>s.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0));
function lawSegment(title){return title.replace(/^تم\s+نسخ\s+/,'').replace(/^ظهير[\s\S]*?(?:بتنفيذ|بسن)\s+(?:نص\s+)?/,'').replace(/^(?:ظهير|مرسوم)[\s\S]*?بمثابة\s+/,'');}
function primaryHeader(text){
  let header=normalizeSearch(text).slice(0,12000).replace(/(\d)\s*([./-])\s*(?=\d)/g,'$1$2').replace(/شر\s+يف/g,'شريف').replace(/ملك\s+ي/g,'ملكي').replace(/تنظيم\s+ي/g,'تنظيمي').replace(/بمث\s+ابة/g,'بمثابة').replace(/رق\s+م/g,'رقم');
  const stop=header.search(/كما\s+(?:تم|وقع)|لائحة\s+التعديلات|الحمد\s|الطابع\s+الشريف|يعلم\s+من\s+ظهير|(?:^|\n)\s*(?:بناء\s+على|الوزير\s+الاول|رييس\s+الحكومة|رئيس\s+الحكومة|المادة\s+(?:1|الاولى)|الفصل\s+(?:1|الاول))/);
  if(stop>=0)header=header.slice(0,stop);
  return header;
}
export function lawNumberEvidence(title,text='',sourceName=''){
  const normalized=normalizeSearch(title).trim();
  const segment=lawSegment(normalized);
  const explicit=segment.match(new RegExp('^'+LAW+'\\s+(?:رقم\\s*)?('+NUMBER+')'));
  if(explicit)return {number:explicit[1],basis:'primary_title'};
  if(sourceName){
    const clean=sourceName.replace(/^\d+_/,'').replace(/-\d{10,}\.pdf$/i,'').replace(/\.pdf$/i,'');
    const named=lawNumberEvidence(clean,'');
    if(named.number)return {...named,basis:'source_filename_primary_law'};
    if(/بمثابة\s+(?:قانون|مدونة)|بسن\s+قانون/.test(normalized)){
      const instrument=normalizeSearch(clean).match(new RegExp('^(?:ظهير(?:\\s+شريف)?|مرسوم(?:\\s+ملكي)?)\\s+(?:(?:معتبر\\s+)?بمثابة\\s+قانون(?:\\s+تنظيمي)?\\s+)?رقم\\s*('+NUMBER+')'));
      if(instrument&&/^(?:[12]\.\d{1,2}\.\d{1,4}|\d{1,4}[.-]\d{2})$/.test(instrument[1]))return {number:instrument[1],basis:'source_filename_primary_instrument'};
    }
  }
  const header=primaryHeader(text);
  const law=header.match(new RegExp('(?:^|\\n|تنفيذ\\s+)\\s*(?:تم\\s+نسخ\\s+)?'+LAW+'\\s+رقم\\s*('+NUMBER+')'));
  if(law)return {number:law[1],basis:'primary_header'};
  // A dahir/decree having force of law can have its own instrument number.
  // Do not borrow a number from amendment lists, citations or later articles.
  if(/بمثابة\s+(?:قانون|مدونة)|بسن\s+قانون|المصادقة\s+على\s+مجموعة\s+القانون|^مرسوم[\s-]+قانون/.test(normalized+'\n'+header)){
    const instrument=header.match(new RegExp('(?:^|\\n)\\s*(?:ال)?(?:ظهير(?:\\s+شريف)?|مرسوم(?:\\s+(?:ملكي|قانون))?)(?:\\s+(?:معتبر\\s+)?بمثابة\\s+قانون(?:\\s+تنظيمي)?)?\\s+رقم\\s*('+NUMBER+')'));
    if(instrument)return {number:instrument[1],basis:'primary_instrument_header'};
    const fromTitle=normalized.match(new RegExp('^(?:ظهير(?:\\s+شريف)?|مرسوم(?:\\s+(?:ملكي|قانون))?)\\s+رقم\\s*('+NUMBER+')'));
    if(fromTitle)return {number:fromTitle[1],basis:'primary_instrument_title'};
  }
  const approved=header.match(new RegExp('المصادق\\s+عليها\\s+بالظهير\\s+الشريف\\s+رقم\\s*('+NUMBER+')'));
  if(approved)return {number:approved[1],basis:'primary_approved_code_header'};
  return {number:'',basis:'not_found_in_primary_heading'};
}
function cleanDirectSubject(value){return String(value||'').replace(/\s+/g,' ').trim().replace(/^(?:بشأن|بشان|في شأن|في شان|حول|المتعلق(?:ة)?\s+ب|يتعلق\s+ب)\s*/,'').replace(/^ب(?=(?:إحداث|احداث|تحديد|تنظيم|تتميم|تغيير|إلغاء|الغاء|تطبيق|منع|سن)(?:\s|$))/,'').trim();}
export function legislationHeading(d,text='',options={}){
  const originalTitle=String(d.title||'');
  const kind=kindOf(d);
  if(d.type!=='national'||kind!=='law'){const subject=cleanDirectSubject(originalTitle);return {title:subject,originalTitle,kind,number:'',basis:'not_a_law',subject};}
  let evidence=options.numberOverride?{number:options.numberOverride,basis:options.overrideBasis||'source_compared_override'}:lawNumberEvidence(originalTitle,text,options.sourceName||'');
  if(evidence.number&&!/^(?:\d{1,3}(?:[./-]\d{2})?|[12]\.\d{1,2}\.\d{1,4}|\d{1,4}[.-]\d{2})$/.test(evidence.number))evidence={number:'',basis:'unreliable_number_shape',candidate:evidence.number};
  let subject=digits(originalTitle.normalize('NFKC').replace(/ـ/g,'').replace(/ی/g,'ي')).replace(/\s+/g,' ').trim().replace(/^تم\s+نسخ\s+/,'').replace(/^ال(?=ظهير|مرسوم)/,'');
  subject=subject.replace(/^ظهير[\s\S]*?(?:بتنفيذ|بسن)\s+(?:نص\s+)?/,'').replace(/^(?:ظهير|مرسوم)[\s\S]*?بمثابة\s+/,'').replace(/^ظهير[\s\S]*?بالمصادقة\s+على\s+/,'');
  subject=subject.replace(new RegExp('^(?:ال)?قانون(?:\\s*[–-]?\\s*(?:التنظيم[يى]|تنظيم[يى]|الإطار|إطار))?(?:\\s+رقم\\s*'+NUMBER+')?\\s*'),'').replace(/^بمثابة\s+/,'');
  subject=cleanDirectSubject(subject).replace(/^(?:(?:ال)?متعلق(?:ة)?|يتعلق)\s+ب\s*/,'').replace(/^(?:القاضي|يقضي|الرامي|الرامية)\s+ب\s*/,'').replace(/^(?:المؤذن|يؤذن)\s+بموجبه\s+في\s+/,'');
  subject=subject.replace(/^ب(?=تنظيم|تغيير|تتميم|تحديد|إحداث|احداث|سن|المصادقة|إلغاء|الغاء|منع)/,'');
  subject=subject.replace(/\s+(?:الصادر|الصادرة)\s+بتنفيذه(?:ا)?\s+الظهير[\s\S]*$/,'').replace(/\s*\(\s*(?:صادر|الصادر|صادرة|الصادرة)\s+بتاريخ[^)]*\)\s*$/,'').trim();
  if(!subject)subject=originalTitle;
  return {title:evidence.number?evidence.number+' — '+subject:subject,originalTitle,kind,subject,...evidence};
}
export const instrumentOrderSql=alias=>`${alias}.abrogated ASC,CASE ${alias}.kind WHEN 'law' THEN 0 WHEN 'dahir' THEN 1 WHEN 'decree' THEN 2 WHEN 'order' THEN 3 WHEN 'other' THEN 4 WHEN 'decision' THEN 5 WHEN 'jurisprudence' THEN 6 ELSE 7 END ASC`;

