const OFFICIAL_HOSTS = new Set([
  'adala.justice.gov.ma', 'justice.gov.ma', 'mahakim.ma', 'cspj.ma', 'sgg.gov.ma',
  'cg.gov.ma', 'chambredesrepresentants.ma', 'chambredesconseillers.ma', 'maroc.ma',
  'pmp.ma', 'cese.ma', 'cndh.ma', 'conseil-concurrence.ma', 'cour-constitutionnelle.ma',
  'ccomptes.ma', 'ancfcc.gov.ma', 'habous.gov.ma', 'finances.gov.ma', 'agriculture.gov.ma',
]);

function trustedOfficialUrl(value) {
  try {
    const url = new URL(String(value || '').replace(/^http:\/\//i, 'https://'));
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase();
    return OFFICIAL_HOSTS.has(host) || host.endsWith('.gov.ma') ? url.href : '';
  } catch { return ''; }
}

const INSTITUTION_SOURCES = [
  [/مجلس النواب/, 'https://www.chambredesrepresentants.ma/'],
  [/مجلس المستشارين/, 'https://www.chambredesconseillers.ma/ar'],
  [/البرلمان/, 'https://www.maroc.ma/ar/le-maroc/parlement'],
  [/المجلس الأعلى للسلطة القضائية|المجلس الأعلى للقضاء/, 'https://www.cspj.ma/'],
  [/رئاسة النيابة العامة|النيابة العامة/, 'https://www.pmp.ma/'],
  [/محكمة النقض|المجلس الأعلى/, 'https://justice.gov.ma/cour-de-cassation/'],
  [/المحكمة الدستورية/, 'https://www.cour-constitutionnelle.ma/'],
  [/المجلس الاقتصادي والاجتماعي والبيئي/, 'https://www.cese.ma/'],
  [/المجلس الوطني لحقوق الإنسان/, 'https://www.cndh.ma/'],
  [/مجلس المنافسة/, 'https://www.conseil-concurrence.ma/'],
  [/المجلس الأعلى للحسابات|المحاكم المالية/, 'https://www.ccomptes.ma/'],
  [/المحافظة العقارية|التحفيظ العقاري/, 'https://www.ancfcc.gov.ma/'],
  [/وزارة العدل|التنظيم الهيكلي|محكمة الاستئناف|المحكمة الابتدائية|المحكمة التجارية|المحكمة الإدارية/, 'https://mahakim.ma/'],
  [/الحكومة|رئيس الحكومة|رئاسة الحكومة|السلطة التنفيذية|الوزارة الأولى/, 'https://www.cg.gov.ma/ar'],
  [/الأمانة العامة للحكومة|الجريدة الرسمية|القوانين الوطنية|اتفاقية|اتفاقيات|معاهدة|المادة/, 'https://www.sgg.gov.ma/Bulletinofficiel.aspx'],
];

/** A specific verified official document URL wins; otherwise use a verified Moroccan institution portal. */
export function officialSourceForDocument(doc = {}) {
  for (const candidate of [doc.officialUrl, doc.officialSourceUrl, doc.sourceUrl]) {
    const trusted = trustedOfficialUrl(candidate);
    if (trusted) return trusted;
  }
  const description = `${doc.title || ''} ${doc.category || ''} ${doc.subcategory || ''}`;
  if (doc.type === 'juriscassation') return 'https://justice.gov.ma/cour-de-cassation/';
  if (doc.type === 'judicial') return 'https://mahakim.ma/';
  for (const [pattern, url] of INSTITUTION_SOURCES) if (pattern.test(description)) return url;
  if (doc.type === 'national' || doc.kind === 'law' || doc.category === 'اتفاقيات ومعاهدات') return 'https://www.sgg.gov.ma/Bulletinofficiel.aspx';
  return '';
}
