/*
 * الإحالات القانونية في النصوص: «الفصل 230 من ق.ل.ع»، «المادة 204 من القانون رقم 58.25»، «الفصلين 38 و39 من ق.م.م».
 * - parseRefs(text): مواضع الإحالات مع مفتاح القانون ورقم الفصل أو المادة.
 * - lawKeyOf(title, lawNumber): مفتاح القانون لوثيقة تشريعية، لتُربط بها الإحالات (النص المذيَّل بالاجتهاد).
 * الربط بالمفاتيح لا بالعناوين الحرة، فلا يُنسب فصل إلى قانون غير قانونه.
 */
export const LAWS = [
  { key: 'qlo', title: 'الالتزامات والعقود', abbr: ['ق.ل.ع', 'ق ل ع', 'ق.ل.ع.'], names: ['قانون الالتزامات والعقود', 'ظهير الالتزامات والعقود', 'الالتزامات والعقود'] },
  /* المسطرة المدنية: القانون 58.25 (نافذ منذ 24 غشت 2026) يرقّم «مواد»، والظهير القديم (1974) يرقّم «فصولاً»؛
     فالإحالة بـ«الفصل» تذهب إلى القديم، وبـ«المادة» أو بالرقم 58.25 إلى الجديد. */
  { key: 'cpc', title: 'المسطرة المدنية', number: '58.25', abbr: ['ق.م.م', 'ق م م', 'م.م'], names: ['قانون المسطرة المدنية', 'المسطرة المدنية'] },
  { key: 'cpp', title: 'المسطرة الجنائية', abbr: ['ق.م.ج', 'ق م ج', 'م.ج'], names: ['قانون المسطرة الجنائية', 'المسطرة الجنائية'] },
  { key: 'penal', title: 'مجموعة القانون الجنائي', abbr: ['ق.ج', 'ق ج', 'م.ق.ج'], names: ['مجموعة القانون الجنائي', 'القانون الجنائي'] },
  { key: 'family', title: 'مدونة الأسرة', abbr: ['م.أ', 'م أ', 'م.ا'], names: ['مدونة الأسرة', 'مدونة الاسرة'] },
  { key: 'commerce', title: 'مدونة التجارة', abbr: ['م.ت', 'م ت'], names: ['مدونة التجارة'] },
  { key: 'labour', title: 'مدونة الشغل', abbr: ['م.ش', 'م ش'], names: ['مدونة الشغل'] },
  { key: 'realrights', title: 'مدونة الحقوق العينية', abbr: ['م.ح.ع', 'م ح ع'], names: ['مدونة الحقوق العينية'] },
  { key: 'traffic', title: 'مدونة السير', abbr: [], names: ['مدونة السير على الطرق', 'مدونة السير'] },
  { key: 'registration', title: 'التحفيظ العقاري', abbr: [], names: ['ظهير التحفيظ العقاري', 'قانون التحفيظ العقاري', 'التحفيظ العقاري'] },
  { key: 'constitution', title: 'دستور المملكة المغربية لسنة 2011', abbr: [], names: ['الدستور', 'دستور المملكة'] },
  { key: 'bar', title: 'مهنة المحاماة', number: '66.23', abbr: [], names: ['القانون المنظم لمهنة المحاماة', 'قانون مهنة المحاماة'] },
];

export const normalizeRef = s => String(s || '')
  .replace(/[ً-ٰٟـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
  .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/\s+/g, ' ').trim();

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tolerant = s => esc(normalizeRef(s)).replace(/ا/g, '[اأإآٱ]').replace(/ي/g, '[يى]').replace(/\\\./g, '\\s*\\.?\\s*').replace(/ /g, '\\s+');

/* الإحالة: (الفصل|المادة|الفصلين|المادتين|الفصول|المواد) رقم [و رقم...] (من|في) (القانون|ظهير)? اسم القانون أو اختصاره أو «القانون رقم X» */
const ARTICLE = '(?:ال)?(?:فصل|فصلين|فصول|ماده|مادة|مادتين|مواد)';
const NUMS = '(\\d{1,4}(?:[-–]\\d{1,3})?(?:\\s*(?:و|،|,|الى|إلى)\\s*\\d{1,4}(?:[-–]\\d{1,3})?)*)';
const LAW_ALTS = LAWS.flatMap(law => [...law.names, ...law.abbr].map(name => ({ key: law.key, re: tolerant(name) }))).sort((a, b) => b.re.length - a.re.length);
const NUMBERED = LAWS.filter(l => l.number);

const REF_RE = new RegExp(`(${ARTICLE.replace('ماده|مادة', 'ماد[ةه]')})\\s+${NUMS}\\s+(?:من|في|ب)\\s*(?:ال)?(?:قانون|ظهير|مدونة|مدونه)?\\s*(?:رقم\\s*)?(${LAW_ALTS.map(a => a.re).join('|')}|\\d{1,3}[.]\\d{2})`, 'g');

function keyOfMatch(raw) {
  const value = normalizeRef(raw);
  const numbered = NUMBERED.find(law => value === law.number);
  if (numbered) return numbered.key;
  for (const alt of LAW_ALTS) if (new RegExp(`^${alt.re}$`).test(value)) return alt.key;
  return '';
}

export function parseRefs(text) {
  const source = String(text || '');
  const normal = normalizeRef(source);
  /* normalizeRef لا يغيّر الطول إلا بحذف التشكيل؛ نعمل على النص المطبَّع ونعيد مواضع تقريبية من بحث النص الأصلي */
  const out = [];
  for (const m of normal.matchAll(REF_RE)) {
    let lawKey = keyOfMatch(m[3]);
    if (!lawKey) continue;
    if (lawKey === 'cpc' && /فصل|فصول/.test(m[1]) && normalizeRef(m[3]) !== '58.25') lawKey = 'cpc1974';
    const articles = [...m[2].matchAll(/\d{1,4}(?:[-–]\d{1,3})?/g)].map(x => x[0].replace('–', '-'));
    out.push({ text: m[0].trim(), index: m.index, lawKey, articles });
  }
  return out;
}

/* مفتاح القانون لوثيقة تشريعية: من رقمها أولاً، ثم من عنوانها المطابق لأسماء القانون */
export function lawKeyOf(title = '', lawNumber = '') {
  const number = normalizeRef(lawNumber);
  const byNumber = NUMBERED.find(law => number && number === law.number);
  if (byNumber) return byNumber.key;
  if (/المسطره المدنيه|المسطرة المدنية/.test(normalizeRef(title)) && !/58\.25/.test(normalizeRef(title))) return 'cpc1974';
  const t = normalizeRef(title).replace(/^(ال)?(ظهير|قانون|مدونه|مدونة)\s+(شريف\s+)?/, '');
  for (const law of LAWS) {
    const names = [law.title, ...law.names].map(normalizeRef);
    if (names.some(name => t === name || t === name.replace(/^(قانون|ظهير|مدونة)\s+/, ''))) return law.key;
  }
  return '';
}

export const lawTitle = key => key === 'cpc1974' ? 'قانون المسطرة المدنية (ظهير 1974)' : LAWS.find(l => l.key === key)?.title || '';
