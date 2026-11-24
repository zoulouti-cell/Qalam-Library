/*
 * التنبيهات الشخصية: المشترك «يتابع» قانوناً (بمفتاحه) أو موضوعاً (كلمات)، فيصله بريد واحد مجمَّع
 * بما نُشر من مستجدات تخصه. لا رسالة دون جديد، ولا يُعاد إرسال ما أُرسل.
 */
import { parseRefs, lawKeyOf, normalizeRef } from './legal-refs.mjs';

export const MAX_FOLLOWS = 30;

const fold = s => normalizeRef(s).replace(/ة/g, 'ه');
const words = s => fold(s).split(/[^\p{L}\p{N}.]+/u).filter(w => w.length >= 3);

export function cleanFollow(input = {}) {
  if (input.type === 'law' && /^[a-z0-9]{2,20}$/.test(String(input.key || ''))) return { type: 'law', key: input.key, title: String(input.title || '').slice(0, 160) };
  const q = String(input.q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (input.type === 'topic' && words(q).length) return { type: 'topic', q, title: q };
  return null;
}

export const followId = f => f.type === 'law' ? `law:${f.key}` : `topic:${fold(f.q)}`;

function itemText(item) {
  const kw = String(item.summary || '').match(/الكلمات المفتاحية:\s*([^\n]+)/)?.[1] || '';
  return `${item.title || ''} ${item.originalTitle || ''} ${kw} ${String(item.summary || '').slice(0, 4000)}`;
}

export function matches(item, follow) {
  if (follow.type === 'law') {
    if (lawKeyOf(item.title || '', item.officialNumber || '') === follow.key) return true;
    return parseRefs(itemText(item)).some(ref => ref.lawKey === follow.key);
  }
  const hay = fold(itemText(item));
  return words(follow.q).every(w => hay.includes(w));
}

/* لكل مستخدم: المستجدات التي تطابق متابعاته (المغربية والفرنسية معاً، كما ينشرها الراصد) */
export function digest(items = [], users = []) {
  const out = new Map();
  for (const user of users) {
    const follows = Array.isArray(user.follows) ? user.follows : [];
    if (!follows.length || !user.email) continue;
    const hits = [];
    for (const item of items) {
      const by = follows.filter(f => matches(item, f));
      if (by.length) hits.push({ item, by: by.map(f => f.title || f.q || f.key) });
    }
    if (hits.length) out.set(user.email, hits);
  }
  return out;
}

export function digestMail(hits, baseUrl) {
  const lines = hits.map(({ item, by }) => `• ${item.title}${item.officialNumber || item.caseNumber ? ` (${item.officialNumber || item.caseNumber})` : ''}\n  يخص: ${by.join('، ')}\n  ${baseUrl}/?doc=${encodeURIComponent(item.documentId || `monitor-${String(item._id || item.id).slice(0, 20)}`)}`);
  const subject = `مكتبة قلم: ${hits.length} ${hits.length === 1 ? 'مستجد يخص' : 'مستجدات تخص'} ما تتابعونه`;
  const text = `${subject}\n\n${lines.join('\n\n')}\n\nلإيقاف متابعة: افتحوا أي قانون في المكتبة واضغطوا زر المتابعة.`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:1.8"><p><strong>${esc(subject)}</strong></p><ul>${hits.map(({ item, by }) => `<li><a href="${esc(baseUrl)}/?doc=${encodeURIComponent(item.documentId || `monitor-${String(item._id || item.id).slice(0, 20)}`)}">${esc(item.title)}</a><br><small>يخص: ${esc(by.join('، '))}</small></li>`).join('')}</ul><p><small>لإيقاف متابعة: افتحوا القانون في المكتبة واضغطوا زر المتابعة.</small></p></div>`;
  return { subject, text, html };
}
