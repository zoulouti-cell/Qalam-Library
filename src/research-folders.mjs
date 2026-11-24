/*
 * ملفات البحث: يجمع المشترك في «ملف بحث» مسمّى نصوصاً وقرارات أو مقاطع منها مع ملاحظته،
 * ثم يصدّره مذكرةً واحدة (Word أو صفحة طباعة تُحفظ PDF). تُحفظ في حسابه وحده.
 */
export const MAX_FOLDERS = 20;
export const MAX_ITEMS = 150;

const line = (v, n) => String(v ?? '').replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function cleanItem(input = {}) {
  const docId = line(input.docId, 120);
  if (!/^[\p{L}\p{N}:._-]{1,120}$/u.test(docId)) return null;
  return { id: id(), docId, title: line(input.title, 300) || docId, citation: line(input.citation, 300), quote: String(input.quote ?? '').replace(/\u0000/g, '').trim().slice(0, 3000), note: line(input.note, 1500), at: new Date().toISOString() };
}

/* عملية واحدة على قائمة ملفات المستخدم؛ تُرجع {folders} أو {error} دون تعديل المدخل */
export function applyFolders(current, body = {}) {
  const folders = (Array.isArray(current) ? current : []).map(f => ({ ...f, items: [...(f.items || [])] }));
  const folder = folders.find(f => f.id === String(body.folderId || body.id || ''));
  switch (body.action) {
    case 'create': {
      const name = line(body.name, 120);
      if (!name) return { error: 'اكتبوا اسم ملف البحث.' };
      if (folders.length >= MAX_FOLDERS) return { error: `الحد الأقصى ${MAX_FOLDERS} ملف بحث.` };
      const created = { id: id(), name, items: [], at: new Date().toISOString() };
      if (body.item) { const item = cleanItem(body.item); if (item) created.items.push(item); }
      return { folders: [created, ...folders], folder: created };
    }
    case 'rename': {
      const name = line(body.name, 120);
      if (!folder || !name) return { error: 'ملف البحث غير موجود.' };
      folder.name = name; return { folders, folder };
    }
    case 'remove':
      if (!folder) return { error: 'ملف البحث غير موجود.' };
      return { folders: folders.filter(f => f !== folder) };
    case 'add': {
      if (!folder) return { error: 'ملف البحث غير موجود.' };
      const item = cleanItem(body.item);
      if (!item) return { error: 'وثيقة غير صالحة.' };
      if (folder.items.length >= MAX_ITEMS) return { error: `الحد الأقصى ${MAX_ITEMS} عنصراً في الملف.` };
      if (folder.items.some(x => x.docId === item.docId && x.quote === item.quote)) return { folders, folder, duplicate: true };
      folder.items.push(item); return { folders, folder };
    }
    case 'removeItem':
      if (!folder) return { error: 'ملف البحث غير موجود.' };
      folder.items = folder.items.filter(x => x.id !== String(body.itemId || '')); return { folders, folder };
    case 'note': {
      const item = folder?.items.find(x => x.id === String(body.itemId || ''));
      if (!item) return { error: 'العنصر غير موجود.' };
      item.note = line(body.note, 1500); return { folders, folder };
    }
    case 'move': {
      if (!folder) return { error: 'ملف البحث غير موجود.' };
      const i = folder.items.findIndex(x => x.id === String(body.itemId || '')), j = i + (body.dir === 'up' ? -1 : 1);
      if (i < 0 || j < 0 || j >= folder.items.length) return { folders, folder };
      [folder.items[i], folder.items[j]] = [folder.items[j], folder.items[i]]; return { folders, folder };
    }
    default: return { error: 'عملية غير معروفة.' };
  }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paras = s => esc(s).split(/\n{1,}/).filter(Boolean).map(p => `<p>${p}</p>`).join('');

/* مذكرة البحث: Word (HTML بصيغة يفتحها Word) أو صفحة طباعة (تُحفظ PDF من المتصفح) */
export function exportFolder(folder, { baseUrl = '', texts = {}, word = false, owner = '' } = {}) {
  const body = folder.items.map((item, i) => {
    const text = item.quote || texts[item.docId] || '';
    return `<section><h2>${i + 1}. ${esc(item.title)}</h2>${item.citation ? `<p class="c">${esc(item.citation)}</p>` : ''}${text ? `<blockquote>${paras(text)}</blockquote>` : ''}${item.note ? `<p class="n"><b>ملاحظة:</b> ${esc(item.note)}</p>` : ''}<p class="u">${esc(baseUrl)}/?doc=${encodeURIComponent(item.docId)}</p></section>`;
  }).join('');
  const date = new Date().toLocaleDateString('fr-MA');
  const head = word ? '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="ar" dir="rtl">' : '<!doctype html><html lang="ar" dir="rtl">';
  return `${head}<head><meta charset="utf-8"><title>${esc(folder.name)}</title><style>
@page{size:A4;margin:2cm}body{font-family:Calibri,'Traditional Arabic',Tahoma,sans-serif;font-size:14pt;line-height:1.7;direction:rtl;text-align:right;color:#111}
h1{font-size:20pt;margin:0 0 4pt}h2{font-size:15pt;margin:18pt 0 4pt;color:#1f5135}.m,.c,.u{color:#555;font-size:11pt}.u{direction:ltr;text-align:left;font-size:9pt}
blockquote{margin:6pt 0;padding:6pt 12pt;border-right:3pt solid #c9a54a;background:#faf7ef}.n{background:#eef5f0;padding:4pt 8pt}
${word ? '' : '@media screen{body{max-width:820px;margin:24px auto;padding:0 16px}}'}</style></head><body>
<h1>${esc(folder.name)}</h1><p class="m">ملف بحث من مكتبة قلم · ${folder.items.length} عنصراً · ${esc(date)}${owner ? ` · ${esc(owner)}` : ''}</p>
${body || '<p>الملف فارغ.</p>'}
<p class="m">النصوص منقولة من المكتبة الرقمية (قلم)؛ تُراجع في مصادرها الرسمية قبل الاستشهاد.</p>
</body></html>`;
}
