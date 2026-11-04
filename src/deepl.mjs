const ENDPOINTS = new Set(['api-free.deepl.com', 'api.deepl.com']);

export function deeplApiKey() {
  return String(process.env.DEEPL_AUTH_KEY || process.env.DEEPL_API_KEY || '').trim();
}

function translationEndpoint() {
  const configured = String(process.env.DEEPL_API_URL || 'https://api-free.deepl.com').trim();
  let url;
  try { url = new URL(configured); } catch { throw new Error('DEEPL_API_URL ليس عنواناً صالحاً.'); }
  if (url.protocol !== 'https:' || !ENDPOINTS.has(url.hostname) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('DEEPL_API_URL يجب أن يكون https://api-free.deepl.com أو https://api.deepl.com.');
  }
  return url.origin + '/v2/translate';
}

export async function translateWithDeepL(text, targetLang = 'FR') {
  const source = String(text || '').trim();
  const key = deeplApiKey();
  if (!key) throw new Error('الترجمة غير مهيأة؛ أضف DEEPL_AUTH_KEY إلى متغيرات Render.');
  if (!source) throw new Error('لا يوجد نص لترجمته.');
  if (source.length > 6500) throw new Error('قسّم النص إلى مقاطع أقصر قبل الترجمة.');
  const response = await fetch(translationEndpoint(), {
    method: 'POST',
    headers: { authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: [source], source_lang: 'AR', target_lang: targetLang }),
    signal: AbortSignal.timeout(35_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.message || `أعادت DeepL الحالة HTTP ${response.status}.`).slice(0, 240));
  const translation = String(result.translations?.[0]?.text || '').trim();
  if (!translation) throw new Error('لم تُرجع DeepL ترجمة.');
  return translation;
}
