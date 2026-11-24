/*
 * فهرس الإحالات: يربط كل فصل أو مادة من القوانين الأساسية بالقرارات القضائية التي أحالت عليه
 * (النص المذيَّل بالاجتهاد)، ويحلّ الإحالة الواردة في نص إلى وثيقة القانون وموضع الفصل منه.
 * يُبنى مرة في الخلفية عند أول طلب ثم يُحفظ في الذاكرة؛ القاعدة للقراءة فقط.
 */
import { brotliDecompressSync } from 'node:zlib';
import { parseRefs, lawKeyOf, normalizeRef } from './legal-refs.mjs';

const MAX_PER_ARTICLE = 12;

export function articleText(text, n) {
  const source = String(text || '');
  const num = String(n).replace(/[^\d-]/g, '');
  if (!num) return '';
  const heading = new RegExp(`(^|\\n)\\s*(?:ال)?(?:فصل|مادة|ماده)\\s+${num.replace('-', '[-–]')}(?![\\d-])[^\\n]*`, 'u');
  const start = source.search(heading);
  if (start < 0) return '';
  const rest = source.slice(start).replace(/^\n/, '');
  const next = rest.slice(1).search(/\n\s*(?:ال)?(?:فصل|مادة|ماده)\s+\d{1,4}(?:[-–]\d{1,3})?(?![\d])/u);
  return (next < 0 ? rest : rest.slice(0, next + 1)).trim().slice(0, 20000);
}

export class RefIndex {
  constructor(library) { this.library = library; this.laws = null; this.annotations = null; this.building = null; }

  /* مفتاح القانون → معرّف وثيقته (الأقصر عنواناً من القوانين الوطنية المطابقة) */
  lawDocs() {
    if (this.laws) return this.laws;
    const map = new Map();
    for (const row of this.library.db.prepare("SELECT id,title,law_number FROM documents WHERE type='national'").all()) {
      const key = lawKeyOf(row.title, row.law_number || '');
      if (!key) continue;
      const current = map.get(key);
      if (!current || String(row.title).length < String(current.title).length) map.set(key, { id: row.id, title: row.title });
    }
    for (const doc of this.library.managedDocs?.values?.() || []) {
      if ((doc.type || 'national') !== 'national') continue;
      const key = lawKeyOf(doc.title, doc.lawNumber || '');
      if (key && !map.has(key)) map.set(key, { id: doc.documentId, title: doc.title });
    }
    return this.laws = map;
  }

  resolve(text) {
    const ref = parseRefs(text)[0];
    if (!ref) return null;
    const law = this.lawDocs().get(ref.lawKey);
    if (!law) return { lawKey: ref.lawKey, articles: ref.articles, id: '' };
    const article = ref.articles[0] || '';
    const word = /ماد/.test(normalizeRef(ref.text)) ? 'المادة' : 'الفصل';
    return { lawKey: ref.lawKey, articles: ref.articles, id: law.id, title: law.title, needle: article ? `${word} ${article}` : '' };
  }

  /* يبني الفهرس على دفعات صغيرة حتى لا يحجز الخادم */
  build() {
    if (this.annotations) return Promise.resolve(this.annotations);
    if (this.building) return this.building;
    this.building = (async () => {
      const index = new Map();
      const rows = this.library.db.prepare("SELECT id,title,type,category,date,body FROM documents WHERE type IN ('juriscassation','judicial')").all();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.type === 'judicial' && /دراسات|تقارير|تقرير|مقالات|نشرة|مجلة|أبحاث|ابحاث|بحوث/.test(row.category || '')) continue;
        let text = '';
        try { text = brotliDecompressSync(Buffer.from(row.body)).toString('utf8'); } catch { continue; }
        const seen = new Set();
        for (const ref of parseRefs(text.slice(0, 60000))) {
          for (const article of ref.articles) {
            const key = `${ref.lawKey}|${article}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const list = index.get(key) || [];
            if (list.length < MAX_PER_ARTICLE) list.push({ id: row.id, title: String(row.title || '').slice(0, 200), date: row.date || '' });
            index.set(key, list);
          }
        }
        if (i % 200 === 199) await new Promise(resolve => setImmediate(resolve));
      }
      for (const list of index.values()) list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      this.annotations = index;
      this.building = null;
      return index;
    })();
    return this.building;
  }

  /* للوثيقة التشريعية: {lawKey, articles: {رقم: [قرارات]}}؛ building:true أثناء البناء الأول */
  async annotationsFor(doc) {
    const key = lawKeyOf(doc?.title || '', doc?.lawNumber || '');
    if (!key) return { lawKey: '', articles: {} };
    if (!this.annotations) { this.build().catch(() => { this.building = null; }); return { lawKey: key, articles: {}, building: true }; }
    const articles = {};
    for (const [k, list] of this.annotations) {
      const [lawKey, article] = k.split('|');
      if (lawKey === key) articles[article] = list;
    }
    return { lawKey: key, articles };
  }
}
