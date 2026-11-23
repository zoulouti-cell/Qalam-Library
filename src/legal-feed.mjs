import { gunzipSync } from 'node:zlib';
import { makeObservation } from './legal-monitoring.mjs';
import { decisionKey } from './card-audit.mjs';

/* التغذية اليومية الثابتة: برنامج لا يستعمل الذكاء الاصطناعي، يقرأ كل يوم المصادر الرسمية المفتوحة
   (البيانات المفتوحة لـ DILA: الجريدة الرسمية الفرنسية JORF، ومجلس الدولة JADE، والمجلس الدستوري CONSTIT؛
   وقائمة قرارات المحكمة الدستورية المغربية)، ويطبّق الجزء الآلي من معيار الانتقاء، ويضع ما يجده «مرشحاً»
   محجوزاً في الراصد. لا يُنشر المرشح أبداً؛ يكتب الجامع بطاقته وترجمته يوم السبت بالرقم نفسه فتحل محله. */

export const DILA = 'https://echanges.dila.gouv.fr/OPENDATA/';
export const CC_MA = 'https://www.cour-constitutionnelle.ma/';
export const LOOKBACK_DAYS = 10;
export const CANDIDATE_TTL_DAYS = 21;
export const CANDIDATE_REASON = 'مرشح آلي من المصدر الرسمي: بانتظار الجامع لكتابة البطاقة وترجمتها.';

/* tar بسيط (ustar): يكفي لأرشيفات DILA. */
export function* untar(buffer) {
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) return;
    const field = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '').trim();
    const prefix = field(345, 155), name = (prefix ? prefix + '/' : '') + field(0, 100);
    const size = parseInt(field(124, 12) || '0', 8) || 0, type = field(156, 1) || '0';
    const start = offset + 512;
    if (type === '0' || type === '') yield { name, data: buffer.subarray(start, start + size) };
    offset = start + Math.ceil(size / 512) * 512;
  }
}

const tag = (xml, name) => { const m = String(xml).match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''; };
const daysAgo = (now, d) => new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10);

/* أسماء الأرشيفات الأحدث من آخر أرشيف عولج (أو من نافذة الأيام الأخيرة في أول تشغيل). */
export function newArchives(listingHtml, prefix, lastDone = '', now = new Date()) {
  const floor = (lastDone || daysAgo(now, LOOKBACK_DAYS).replace(/-/g, '') + '-000000');
  const names = [...new Set([...String(listingHtml).matchAll(new RegExp(`href="(${prefix}_(\\d{8}-\\d{6})\\.tar\\.gz)"`, 'g'))].map(m => m[2]))];
  return names.filter(stamp => stamp > floor).sort();
}

/* مجلس الدولة: قرارات المجلس نفسه المنشورة في المجموعة (A) وحدها؛ أما الجداول (B) فتقديرها للجامع. */
export function jadeCandidates(files, now = new Date()) {
  const out = [], since = daysAgo(now, LOOKBACK_DAYS);
  for (const { name, data } of files) {
    if (!/CETATEXT\d+\.xml$/.test(name)) continue;
    const xml = data.toString('utf8');
    if (tag(xml, 'JURIDICTION') !== "Conseil d'Etat" || tag(xml, 'PUBLI_RECUEIL') !== 'A') continue;
    const date = tag(xml, 'DATE_DEC'); if (!date || date < since) continue;
    const id = tag(xml, 'ID'), number = tag(xml, 'NUMERO');
    out.push({ country: 'fr', kind: 'case_law', court: "Conseil d'État", caseNumber: number, officialNumber: number, eventDate: date, originalTitle: tag(xml, 'TITRE'),
      title: `قرار مجلس الدولة الفرنسي رقم ${number} (منشور في المجموعة)`,
      source: { url: `https://www.legifrance.gouv.fr/ceta/id/${id}`, label: 'مجلس الدولة الفرنسي (Conseil d\'État) — قاعدة الاجتهاد الإداري الرسمية (Légifrance/JADE)' } });
  }
  return out;
}

/* المجلس الدستوري الفرنسي: قرارات DC وQPC (لا الانتخابية). */
export function constitCandidates(files, now = new Date()) {
  const out = [], since = daysAgo(now, LOOKBACK_DAYS);
  for (const { name, data } of files) {
    if (!/CONSTEXT\d+\.xml$/.test(name)) continue;
    const xml = data.toString('utf8'), nature = tag(xml, 'NATURE');
    if (!['QPC', 'DC'].includes(nature)) continue;
    const date = tag(xml, 'DATE_DEC'); if (!date || date < since) continue;
    const number = `${tag(xml, 'NUMERO')} ${nature}`;
    out.push({ country: 'fr', kind: 'case_law', court: 'Conseil constitutionnel', caseNumber: number, officialNumber: number, eventDate: date, originalTitle: tag(xml, 'TITRE'),
      title: `قرار المجلس الدستوري الفرنسي رقم ${number}`,
      source: { url: tag(xml, 'URL_CC') || `https://www.legifrance.gouv.fr/cons/id/${tag(xml, 'ID')}`, label: 'المجلس الدستوري الفرنسي (Conseil constitutionnel)' } });
  }
  return out;
}

/* الجريدة الرسمية الفرنسية: القوانين والقوانين التنظيمية والأوامر، والمراسيم التي تعدّل مدونة؛ لا التعيينات ولا الجهوي. */
const EXCLUDED_TITLE = /portant nomination|nomination|cessation de fonctions|admission|concours|examen|départemental|régional|commune de|préfecture|à titre (?:exceptionnel|temporaire)|prorogation/i;
export function jorfCandidates(files, now = new Date()) {
  const struct = new Map(), versions = [], since = daysAgo(now, LOOKBACK_DAYS);
  for (const { name, data } of files) {
    const m = name.match(/texte\/(struct|version)\/JORF\/TEXT\/.*(JORFTEXT\d+)\.xml$/); if (!m) continue;
    const xml = data.toString('utf8');
    if (m[1] === 'struct') struct.set(m[2], { eli: tag(xml, 'ID_ELI'), num: tag(xml, 'NUM') });
    else versions.push({ id: m[2], xml });
  }
  const out = [], seen = new Set();
  for (const { id, xml } of versions) {
    if (seen.has(id)) continue; seen.add(id);
    const nature = tag(xml, 'NATURE'), title = tag(xml, 'TITREFULL') || tag(xml, 'TITRE'), published = tag(xml, 'DATE_PUBLI');
    if (!published || published < since || EXCLUDED_TITLE.test(title)) continue;
    const wanted = ['LOI', 'LOI_ORGANIQUE', 'ORDONNANCE'].includes(nature) || (nature === 'DECRET' && /\bcode\b/i.test(title));
    if (!wanted) continue;
    const s = struct.get(id) || {}, number = s.num || tag(xml, 'NOR');
    const label = { LOI: 'القانون', LOI_ORGANIQUE: 'القانون التنظيمي', ORDONNANCE: 'الأمر التشريعي', DECRET: 'المرسوم' }[nature];
    out.push({ country: 'fr', kind: 'legislation', currentStage: 'published', officialNumber: number, reference: tag(xml, 'NOR'), eventDate: published, originalTitle: title,
      title: `${label} الفرنسي رقم ${number}`,
      source: { url: s.eli || `https://www.legifrance.gouv.fr/jorf/id/${id}`, label: 'الجريدة الرسمية للجمهورية الفرنسية (Légifrance — JORF)' } });
  }
  return out;
}

/* المحكمة الدستورية المغربية: معرّفات القرارات من الصفحة الرئيسية، ثم رقم القرار وتاريخه من صفحته. */
export const ccMaIds = html => [...new Set([...String(html).matchAll(/Decision\?id=(\d+)&(?:amp;)?Page=Decision/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
export function ccMaDecision(html, id) {
  const text = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const after = label => { const i = lines.findIndex(l => l.startsWith(label)); return i > -1 ? (lines[i].slice(label.length).replace(/^[\s:]+/, '') || lines[i + 1] || '') : ''; };
  const number = after('قرار رقم').replace(/\s.*$/, ''), date = after('تاريخ صدور القرار').replace(/\//g, '-');
  if (!/^\d+\/\d+$/.test(number) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { country: 'ma', kind: 'case_law', court: 'المحكمة الدستورية', caseNumber: number, officialNumber: number, eventDate: date,
    title: `قرار المحكمة الدستورية رقم ${number}`,
    source: { url: `${CC_MA}Decision?id=${id}&Page=Decision`, label: 'المحكمة الدستورية للمملكة المغربية' } };
}

/* يحوّل المرشح إلى سجل راصد محجوز بالمعرّف نفسه الذي سيأخذه تسجيل الجامع للنص أو القرار نفسه. */
export function candidateRecord(candidate, now = new Date()) {
  const checked = makeObservation({ ...candidate, summary: CANDIDATE_REASON + ' '.repeat(10) + (candidate.originalTitle || candidate.title), source: { ...candidate.source, official: true, verified: true }, receivedAt: now });
  if (checked.error) return null;
  const r = checked.record;
  return { ...r, _id: r.id, summary: '', fullText: '', state: 'held', readyForAutomaticPublication: false, autoPublishAt: null, holdReason: CANDIDATE_REASON, candidate: true,
    source: { ...r.source, verified: false }, history: [{ state: 'held', at: now, reason: 'feed_candidate' }] };
}

/* هل للنص أو القرار سجل في الراصد (بأي حالة، ومنها ما حذفه المدير)؟ */
export function alreadyKnown(record, existing) {
  const key = decisionKey(record);
  return existing.some(r => r._id === record._id || (key.length >= 3 && r.country === record.country && (r.kind === record.kind || (['legislation', 'bill'].includes(r.kind) && record.kind === 'legislation')) && decisionKey(r) === key));
}

/* التشغيل اليومي. fetchImpl قابل للحقن في الاختبارات. */
export async function runLegalFeed(store, { now = new Date(), fetchImpl = fetch, log = () => {} } = {}) {
  const stateDoc = (await store.settings.findOne({ _id: 'legal-feed' })) || { _id: 'legal-feed' };
  const today = now.toISOString().slice(0, 10);
  if (stateDoc.lastRunDate === today) return { skipped: true };
  const get = async (url, binary = false) => { const r = await fetchImpl(url, { headers: { 'user-agent': 'QalamLibrary-LegalFeed/1.0' }, signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new Error(`${url} → ${r.status}`); return binary ? Buffer.from(await r.arrayBuffer()) : r.text(); };
  const candidates = [], errors = [], done = { ...(stateDoc.archives || {}) };
  for (const [prefix, parse] of [['JORF', jorfCandidates], ['JADE', jadeCandidates], ['CONSTIT', constitCandidates]]) {
    try {
      const stamps = newArchives(await get(DILA + prefix + '/'), prefix, done[prefix], now).slice(-12);
      for (const stamp of stamps) {
        const files = [...untar(gunzipSync(await get(`${DILA}${prefix}/${prefix}_${stamp}.tar.gz`, true)))];
        candidates.push(...parse(files, now));
        done[prefix] = stamp;
      }
    } catch (error) { errors.push(`${prefix}: ${error.message}`); }
  }
  let lastCcMa = Number(stateDoc.lastCcMaId || 0);
  try {
    const ids = ccMaIds(await get(CC_MA)).filter(id => id > lastCcMa).slice(-15);
    for (const id of ids) {
      const decision = ccMaDecision(await get(`${CC_MA}Decision?id=${id}&Page=Decision`), id);
      if (decision && decision.eventDate >= daysAgo(now, LOOKBACK_DAYS * 3)) candidates.push(decision);
      lastCcMa = Math.max(lastCcMa, id);
    }
  } catch (error) { errors.push(`cour-constitutionnelle.ma: ${error.message}`); }

  const existing = await store.legalMonitorItems.find({}, { projection: { _id: 1, country: 1, kind: 1, caseNumber: 1, officialNumber: 1, state: 1 } }).toArray();
  let added = 0;
  for (const candidate of candidates) {
    const record = candidateRecord(candidate, now);
    if (!record || alreadyKnown(record, existing)) continue;
    await store.legalMonitorItems.updateOne({ _id: record._id }, { $setOnInsert: record }, { upsert: true });
    existing.push(record); added++;
  }
  /* المرشح الذي لم يكتبه الجامع خلال ثلاثة أسابيع يُزال (لا محتوى له ولا أصل). */
  const expired = await store.legalMonitorItems.deleteMany({ candidate: true, receivedAt: { $lt: new Date(now.getTime() - CANDIDATE_TTL_DAYS * 86400000) } });
  await store.settings.updateOne({ _id: 'legal-feed' }, { $set: { lastRunDate: today, archives: done, lastCcMaId: lastCcMa, lastResult: { at: now, found: candidates.length, added, expired: expired.deletedCount || 0, errors } } }, { upsert: true });
  log({ found: candidates.length, added, errors });
  return { found: candidates.length, added, expired: expired.deletedCount || 0, errors };
}
