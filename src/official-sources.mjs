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

function arabicOfficialUrl(value) {
  const trusted = trustedOfficialUrl(value);
  if (!trusted) return '';
  const url = new URL(trusted);
  // Preserve direct primary documents, which are the source itself rather than a UI page.
  if (/\.pdf(?:$|[?#])/i.test(url.href)) return url.href;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* Keep the encoded path unchanged. */ }
  if (host === 'sgg.gov.ma' && !/^\/arabe\//i.test(url.pathname)) return 'https://www.sgg.gov.ma/arabe/Accueil.aspx';
  if (host === 'chambredesrepresentants.ma' && !/^\/ar\//i.test(url.pathname)) return 'https://www.chambredesrepresentants.ma/ar';
  if (host === 'chambredesconseillers.ma' && !/^\/ar(?:\/|$)/i.test(url.pathname)) return 'https://www.chambredesconseillers.ma/ar';
  if (host === 'maroc.ma' && !/^\/ar(?:\/|$)/i.test(url.pathname)) return 'https://www.maroc.ma/ar/le-maroc/parlement';
  if (host === 'justice.gov.ma' && url.pathname !== '/' && !/[\u0600-\u06ff]/.test(path)) return 'https://justice.gov.ma/';
  return url.href;
}

const INSTITUTION_SOURCES = [
  [/مجلس النواب/, 'https://www.chambredesrepresentants.ma/ar'],
  [/مجلس المستشارين/, 'https://www.chambredesconseillers.ma/ar'],
  [/البرلمان/, 'https://www.maroc.ma/ar/le-maroc/parlement'],
  [/المجلس الأعلى للسلطة القضائية|المجلس الأعلى للقضاء/, 'https://www.cspj.ma/'],
  [/رئاسة النيابة العامة|النيابة العامة/, 'https://www.pmp.ma/'],
  [/محكمة النقض|المجلس الأعلى/, 'https://justice.gov.ma/محكمة-النقض/'],
  [/المحكمة الدستورية/, 'https://www.cour-constitutionnelle.ma/'],
  [/المجلس الاقتصادي والاجتماعي والبيئي/, 'https://www.cese.ma/'],
  [/المجلس الوطني لحقوق الإنسان/, 'https://www.cndh.ma/'],
  [/مجلس المنافسة/, 'https://www.conseil-concurrence.ma/'],
  [/المجلس الأعلى للحسابات|المحاكم المالية/, 'https://www.ccomptes.ma/'],
  [/المحافظة العقارية|التحفيظ العقاري/, 'https://www.ancfcc.gov.ma/'],
  [/التنظيم الهيكلي لوزارة العدل|التنظيم الهيكلي/, 'https://adala.justice.gov.ma/resources/10'],
  [/وزارة العدل/, 'https://justice.gov.ma/'],
  [/محكمة الاستئناف|المحكمة الابتدائية|المحكمة التجارية|المحكمة الإدارية|المحاكم الابتدائية|محاكم الاستئناف/, 'https://www.mahakim.ma/'],
  [/الحكومة|رئيس الحكومة|رئاسة الحكومة|السلطة التنفيذية|الوزارة الأولى/, 'https://www.cg.gov.ma/ar'],
  [/الأمانة العامة للحكومة|الجريدة الرسمية|القوانين الوطنية|اتفاقية|اتفاقيات|معاهدة|المادة/, 'https://www.sgg.gov.ma/arabe/Accueil.aspx'],
];

/** A specific verified official document URL wins; otherwise use a verified Moroccan institution portal. */
export function officialSourceForDocument(doc = {}) {
  for (const candidate of [doc.officialUrl, doc.officialSourceUrl, doc.sourceUrl]) {
    const trusted = arabicOfficialUrl(candidate);
    if (trusted) return trusted;
  }
  const description = `${doc.title || ''} ${doc.category || ''} ${doc.subcategory || ''}`;
  if (doc.type === 'juriscassation') return 'https://justice.gov.ma/محكمة-النقض/';
  if (doc.type === 'judicial') return 'https://www.mahakim.ma/';
  for (const [pattern, url] of INSTITUTION_SOURCES) if (pattern.test(description)) return url;
  if (doc.type === 'national' || doc.kind === 'law' || /اتفاقي|معاهد/.test(`${doc.category || ''} ${doc.kind || ''} ${doc.type || ''}`)) return 'https://www.sgg.gov.ma/arabe/Accueil.aspx';
  return '';
}
