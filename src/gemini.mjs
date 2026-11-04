const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models/';

export function geminiApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

export function geminiModel() {
  return String(process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
}

export function geminiOcrApiKey(fallback = '') {
  return String(process.env.GEMINI_OCR_API_KEY || geminiApiKey() || fallback || '').trim();
}

export function geminiOcrModel() {
  return String(process.env.GEMINI_OCR_MODEL || geminiModel()).trim();
}

export function geminiOcrEnabled(savedEngine = 'local') {
  if (process.env.GEMINI_OCR_ENABLED !== undefined) return /^(1|true|yes|on)$/i.test(process.env.GEMINI_OCR_ENABLED.trim());
  return savedEngine === 'gemini';
}

export async function generateGeminiText(prompt, { maxOutputTokens = 1200, model = geminiModel(), timeout = 45_000 } = {}) {
  const key = geminiApiKey();
  if (!key) throw new Error('لم يُضبط GEMINI_API_KEY في Render.');
  const response = await fetch(`${API_ROOT}${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: String(prompt).slice(0, 30_000) }] }], generationConfig: { temperature: 0.1, maxOutputTokens, responseMimeType: 'application/json' } }),
    signal: AbortSignal.timeout(timeout),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = String(payload.error?.message || `Gemini API (HTTP ${response.status})`).slice(0, 240);
    throw new Error(reason);
  }
  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('تجاوزت إجابة Gemini الحد المتاح.');
  const text = (candidate?.content?.parts || []).map(part => part.text || '').join('\n').trim();
  if (!text) throw new Error('لم يُرجع Gemini نصاً.');
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export async function translateLegalText(text, language = 'français') {
  const source = String(text || '').trim();
  if (!source) throw new Error('لا يوجد نص لترجمته.');
  if (source.length > 6500) throw new Error('قسّم الجواب إلى مقاطع أقصر قبل الترجمة.');
  const prompt = `أنت مترجم قانوني مغربي محترف. ترجم النص التالي من العربية إلى الفرنسية القانونية المهنية الواضحة، مع الحفاظ على المعنى والقيود والاحتمال والتمييز بين الوقائع والاستنتاج. لا تضف قاعدة أو إحالة أو معلومة، ولا تحذف التحفظات أو الاستشهادات بين الأقواس المربعة. أخرج الترجمة وحدها بصيغة JSON: {"translation":"..."}.\n\nالنص:\n${source}`;
  const raw = await generateGeminiText(prompt, { maxOutputTokens: 1500 });
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('تعذر اعتماد بنية الترجمة؛ أعد المحاولة.'); }
  const translation = String(parsed.translation || '').trim();
  if (translation.length < 8 || translation.length > 12_000) throw new Error('لم تُرجع خدمة الترجمة نصاً صالحاً.');
  return translation;
}
