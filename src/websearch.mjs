/**
 * بحث خارجي في الإنترنت يُستعمل فقط حين يعطّل القارئ التحليل الذكي والترجمة معاً.
 * لا يعتمد على مفتاح API مدفوع؛ يستعلم محرك بحث لا يتطلب تسجيلاً (DuckDuckGo HTML)
 * ويعرض النتائج كما هي (عنوان + مقتطف + رابط رسمي) دون توليد نص بنموذج لغوي،
 * حفاظاً على نفس منطق "استرجاع دون اختلاق" المعتمد في بقية المساعد.
 */
const UA = 'Mozilla/5.0 (compatible; QalamLibraryAssistant/1.0; +https://qalam-library.onrender.com)';

export function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeDuckUrl(href) {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    if (url.hostname.endsWith('duckduckgo.com') && url.searchParams.has('uddg')) {
      return decodeURIComponent(url.searchParams.get('uddg'));
    }
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

export function parseDuckResults(html, limit = 5) {
  const items = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = re.exec(html)) && items.length < limit) {
    const officialUrl = decodeDuckUrl(match[1]);
    const title = stripTags(match[2]);
    const excerpt = stripTags(match[3]);
    if (officialUrl && title) {
      items.push({
        id: 'web-' + (items.length + 1),
        title,
        label: 'نتيجة بحث خارجي',
        excerpt,
        officialUrl,
        textKind: 'web',
        kind: 'web',
        answerReady: true,
        abrogated: false,
      });
    }
  }
  return items;
}

export async function answerFromWeb(question) {
  const q = String(question || '').trim().slice(0, 300);
  if (!q) throw new Error('اكتب السؤال أولاً.');
  let sources = [];
  try {
    const response = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('bad_status');
    sources = parseDuckResults(await response.text(), 5);
  } catch {
    return {
      mode: 'web_search',
      answer: 'تعذر الوصول إلى محرك البحث الخارجي حالياً. جرّب لاحقاً أو فعّل التحليل الذكي أو الاكتفاء بمصادر المكتبة.',
      sources: [],
      limitations: ['لم يستجب محرك البحث الخارجي في الوقت المتاح.'],
      citationsVerified: false,
    };
  }
  if (!sources.length) {
    return {
      mode: 'web_search',
      answer: 'لم يعثر البحث الخارجي على نتائج مرتبطة بهذا السؤال.',
      sources: [],
      limitations: ['جرّب صياغة أدق أو مصطلحاً قانونياً محدداً.'],
      citationsVerified: false,
    };
  }
  const answer =
    'هذه نتائج من بحث خارجي على الإنترنت؛ لا تمثل مصادر المكتبة الرقمية ولم تُراجع من إدارة المكتبة:\n\n' +
    sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.excerpt}`).join('\n\n');
  return {
    mode: 'web_search',
    answer,
    sources,
    limitations: ['نتائج بحث خارجية غير مسندة لمصادر المكتبة؛ تحقق من الرابط الرسمي قبل الاعتماد عليها.'],
    citationsVerified: false,
  };
}
