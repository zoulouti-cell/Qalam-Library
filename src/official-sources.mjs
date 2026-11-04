const OFFICIAL_HOSTS = new Set([
  'adala.justice.gov.ma', 'justice.gov.ma', 'mahakim.ma', 'cspj.ma', 'juriscassation.cspj.ma',
  'sgg.gov.ma', 'cg.gov.ma', 'chambredesrepresentants.ma', 'chambresdesconseillers.ma', 'parlement.ma',
  'maroc.ma', 'pmp.ma', 'cese.ma', 'cndh.ma', 'conseil-concurrence.ma', 'cour-constitutionnelle.ma',
  'ccomptes.ma', 'ancfcc.gov.ma', 'habous.gov.ma', 'finances.gov.ma', 'agriculture.gov.ma',
  'mcrpsc.gov.ma', 'eauxetforets.gov.ma', 'cndp.ma', 'inpplc.ma', 'mediateur.ma',
  'csefrs.ma', 'haca.ma', 'ccme.org.ma',
]);

const SGG = 'https://www.sgg.gov.ma/arabe/Accueil.aspx';
const JUSTICE = 'https://justice.gov.ma/';
const CASSATION = 'https://juriscassation.cspj.ma/';
const CONSTITUTIONAL_COURT = 'https://www.cour-constitutionnelle.ma/';
const PARLIAMENT = 'https://www.chambredesrepresentants.ma/ar';
const COUNCIL_OF_ADVISORS = 'https://www.chambresdesconseillers.ma/';
const CSPJ = 'https://www.cspj.ma/';
const PROSECUTION = 'https://www.pmp.ma/';

function trustedOfficialUrl(value) {
  try {
    const url = new URL(String(value || '').replace(/^http:\/\//i, 'https://'));
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return OFFICIAL_HOSTS.has(host) || host.endsWith('.gov.ma') ? url.href : '';
  } catch { return ''; }
}

function arabicOfficialUrl(value) {
  const trusted = trustedOfficialUrl(value);
  if (!trusted) return '';
  const url = new URL(trusted);
  // Keep the exact official primary document when the stored source is a PDF.
  if (/\.pdf(?:$|[?#])/i.test(url.href)) return url.href;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* Retain its encoded form. */ }
  if (host === 'sgg.gov.ma' && !/^\/arabe\//i.test(url.pathname)) return SGG;
  if (host === 'chambredesrepresentants.ma' && !/^\/ar(?:\/|$)/i.test(url.pathname)) return PARLIAMENT;
  if (host === 'chambresdesconseillers.ma' && !/^\/ar(?:\/|$)/i.test(url.pathname)) return COUNCIL_OF_ADVISORS;
  if (host === 'maroc.ma' && !/^\/ar(?:\/|$)/i.test(url.pathname)) return 'https://www.maroc.ma/ar';
  if (host === 'justice.gov.ma' && url.pathname !== '/' && !/[\u0600-\u06ff]/.test(path)) return JUSTICE;
  return url.href;
}

// These routes are ordered from the most specific institution to general portals.
// They refer to Arabic official Moroccan websites, not search-engine result pages.
const INSTITUTION_SOURCES = [
  [/المحكمة الدستورية|المجلس الدستوري|(?:ال)?دستور(?: المغربي| المملكة)?|المادة الدستورية/, CONSTITUTIONAL_COURT],
  [/المجلس الأعلى للسلطة القضائية|المجلس الأعلى للقضاء|السلطة القضائية/, CSPJ],
  [/قرارات? محكمة النقض|محكمة النقض|المجلس الأعلى(?=\s*(?:،|$|بالمغرب|سابقا))/, CASSATION],
  [/التنظيم الهيكلي لوزارة العدل|تنظيم وزارة العدل|هيكلة وزارة العدل/, 'https://justice.gov.ma/actes_documents/26-التنظيم-الهيكلي-لوزارة-العدل/'],
  [/وزارة العدل/, JUSTICE],
  [/مجلس النواب|الغرفة الأولى للبرلمان/, PARLIAMENT],
  [/مجلس المستشارين|الغرفة الثانية للبرلمان/, COUNCIL_OF_ADVISORS],
  [/البرلمان|السلطة التشريعية/, PARLIAMENT],
  [/رئاسة النيابة العامة|النيابة العامة/, PROSECUTION],
  [/محكمة الاستئناف التجارية|محاكم الاستئناف التجارية/, 'https://justice.gov.ma/محاكم-الإستئناف-التجارية/'],
  [/المحكمة التجارية|المحاكم التجارية/, 'https://justice.gov.ma/المحاكم-التجارية/'],
  [/محكمة الاستئناف الإدارية|محاكم الاستئناف الإدارية/, 'https://justice.gov.ma/محاكم-الإستئناف-الإدارية/'],
  [/المحكمة الإدارية|المحاكم الإدارية/, 'https://justice.gov.ma/المحاكم-الإدارية/'],
  [/محكمة الاستئناف|محاكم الاستئناف/, 'https://justice.gov.ma/محاكم-الإستئناف/'],
  [/المحكمة الابتدائية|المحاكم الابتدائية|محكمة الدرجة الأولى|محاكم الدرجة الأولى/, 'https://justice.gov.ma/المحاكم-الابتدائية/'],
  [/محاكم المملكة|التنظيم القضائي|المحاكم المغربية/, 'https://adala.justice.gov.ma/resources/3'],
  [/الحكومة|رئيسة الحكومة|رئيس الحكومة|رئاسة الحكومة|السلطة التنفيذية|الوزارة الأولى/, 'https://www.cg.gov.ma/ar'],
  [/المجلس الاقتصادي والاجتماعي والبيئي/, 'https://www.cese.ma/'],
  [/المجلس الوطني لحقوق الإنسان/, 'https://www.cndh.ma/'],
  [/اللجنة الوطنية لمراقبة حماية المعطيات|اللجنة الوطنية لحماية المعطيات/, 'https://www.cndp.ma/ar/الرئيسية/'],
  [/الهيئة الوطنية للنزاهة|الوقاية من الرشوة ومحاربتها/, 'https://www.inpplc.ma/ar'],
  [/وسيط المملكة|مؤسسة الوسيط/, 'https://www.mediateur.ma/ar'],
  [/المجلس الأعلى للتربية والتكوين|التربية والتكوين والبحث العلمي/, 'https://www.csefrs.ma/تقديم-عام/'],
  [/الهيئة العليا للاتصال السمعي البصري|الهاكا/, 'https://www.haca.ma/ar'],
  [/مجلس الجالية المغربية بالخارج/, 'https://www.ccme.org.ma/ar'],
  [/مجلس المنافسة/, 'https://www.conseil-concurrence.ma/'],
  [/المجلس الأعلى للحسابات|المحاكم المالية/, 'https://www.ccomptes.ma/'],
  [/المحافظة العقارية|التحفيظ العقاري|الوكالة الوطنية للمحافظة العقارية/, 'https://www.ancfcc.gov.ma/'],
  [/وزارة الأوقاف|الأوقاف والشؤون الإسلامية/, 'https://www.habous.gov.ma/'],
  [/وزارة الاقتصاد والمالية|وزارة المالية|المالية العمومية/, 'https://www.finances.gov.ma/'],
  [/وزارة الفلاحة|الفلاحة والصيد البحري/, 'https://www.agriculture.gov.ma/'],
];

function mappedInstitution(description) {
  for (const [pattern, url] of INSTITUTION_SOURCES) if (pattern.test(description)) return url;
  return '';
}

/**
 * Select the official Arabic source for a library item. Specific institutions
 * and courts take priority; a known Adala source is preserved for ordinary
 * legislation; unknown legislative sources fall back to the SGG portal.
 */
export function officialSourceForDocument(doc = {}) {
  const description = `${doc.title || ''} ${doc.category || ''} ${doc.subcategory || ''}`;
  const scope = `${doc.category || ''} ${doc.subcategory || ''}`;

  // The Constitution and the Ministry's published organizational chart have dedicated
  // official destinations, even if their record also carries a generic source URL.
  if (/(?:ال)?دستور(?: المغربي| المملكة)?|المحكمة الدستورية|المجلس الدستوري|المادة الدستورية/.test(description)) return CONSTITUTIONAL_COURT;
  if (/التنظيم الهيكلي لوزارة العدل|تنظيم وزارة العدل|هيكلة وزارة العدل/.test(description)) {
    return 'https://justice.gov.ma/actes_documents/26-التنظيم-الهيكلي-لوزارة-العدل/';
  }

  // A decision record is routed to the official Court of Cassation jurisprudence portal.
  if (doc.type === 'juriscassation') return CASSATION;

  // A verified URL on a law or treaty is the best record-level source; keep its exact
  // Adala PDF when available instead of replacing it with an institutional homepage.
  for (const candidate of [doc.officialUrl, doc.officialSourceUrl, doc.sourceUrl]) {
    const trusted = arabicOfficialUrl(candidate);
    if (trusted) return trusted;
  }

  // Match institutions and court grades after preferring a known primary document.
  const institution = mappedInstitution(description);
  if (institution && (doc.type !== 'national' || /مؤسسات|هيئات|سلطات|مجالس|تنظيم قضائي/.test(scope))) return institution;

  if (doc.type === 'judicial') return 'https://www.mahakim.ma/';
  if (doc.type === 'national' || doc.kind === 'law' || /اتفاقي|معاهد|قانون|تشريع|مرسوم/.test(`${doc.category || ''} ${doc.kind || ''} ${doc.type || ''}`)) return SGG;
  return '';
}
