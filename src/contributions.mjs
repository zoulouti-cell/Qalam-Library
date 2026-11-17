// إضافات المستخدمين وملاحظاتهم على المكتبة: التحقق من المدخلات، استخراج النص من الملفات، الحالات،
// وبناء رسائل الإشعار. دوال نقية (بلا قاعدة بيانات) كي يسهل اختبارها؛ التخزين والمسارات في server.mjs.
import { createHash, randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { actionButton, paragraphs, renderEmailHtml, renderEmailText } from './email-template.mjs';

/* ───────── الأنواع ───────── */
/* kind: ما يضيفه المستخدم. يقابله (type, kind, category) في فهرس المكتبة عند التحويل إلى مسودة. */
export const KINDS = {
  law: { label: 'نص قانوني', type: 'national', docKind: 'law', category: 'نصوص عامة', hint: 'قانون أو ظهير أو مرسوم أو قرار تنظيمي أو اتفاقية' },
  jurisprudence: { label: 'اجتهاد قضائي', type: 'judicial', docKind: 'jurisprudence', category: 'اجتهادات المحاكم', hint: 'قرار أو حكم أو أمر قضائي مع بيان المحكمة ورقمه وتاريخه' },
  research: { label: 'بحث', type: 'judicial', docKind: 'study', category: 'أبحاث ودراسات', subcategory: 'بحث', hint: 'بحث أو مقال علمي أو أطروحة أو ورقة قانونية' },
  study: { label: 'دراسة', type: 'judicial', docKind: 'study', category: 'أبحاث ودراسات', subcategory: 'دراسة', hint: 'دراسة أو تقرير أو تعليق على نص أو اجتهاد' },
};
export const NOTE_TYPES = {
  error: 'تصحيح خطأ في النص',
  missing: 'نقص أو إحالة ناقصة',
  suggestion: 'اقتراح أو إضافة مفيدة',
  other: 'ملاحظة أخرى',
};
export const STATUSES = {
  pending: 'قيد الدرس',
  reviewing: 'قيد المراجعة والتحرير',
  published: 'اعتُمدت ونُشرت في المكتبة',
  accepted: 'اعتُمدت الملاحظة',
  declined: 'لم تُعتمد',
};
export const LIMITS = {
  textChars: 500000, minTextChars: 40, title: 300, message: 4000, excerpt: 800, reply: 2000, reference: 200,
  fileBytes: 7 * 1024 * 1024, originalBytes: 8 * 1024 * 1024, originalsPerItem: 10, originalsTotalBytes: 16 * 1024 * 1024, storeCapBytes: 300 * 1024 * 1024, orphanFilesPerUser: 14, additionsPerDay: 15, notesPerDay: 40, openAdditions: 40,
};

/* ───────── تنقية النصوص ───────── */
const EASTERN = /[٠-٩]/g, PERSIAN = /[۰-۹]/g;
const ascii = value => String(value ?? '').replace(EASTERN, d => String(d.charCodeAt(0) - 0x660)).replace(PERSIAN, d => String(d.charCodeAt(0) - 0x6f0));
export const oneLine = (value, max) => String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export function cleanText(value, max = LIMITS.textChars) {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‎‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
}
export const textDigest = text => createHash('sha256').update(String(text).replace(/\s+/g, ' ').trim()).digest('hex');
export const newContributionId = () => 'c_' + randomBytes(9).toString('hex');

/* تاريخ الإصدار: يقبل 2024-05-17 أو 17/05/2024 أو 2024-05 أو 2024 (بأرقام عربية أو هندية أيضًا) ويعيده بصيغة ISO جزئية. */
export function normalizeIssuedAt(value) {
  const raw = ascii(value).trim();
  if (!raw) return '';
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) || raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (m) return validDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = raw.match(/^(\d{4})[-\/](\d{1,2})$/);
  if (m) { const y = Number(m[1]), mo = Number(m[2]); return y >= 1800 && y <= new Date().getFullYear() + 1 && mo >= 1 && mo <= 12 ? `${y}-${String(mo).padStart(2, '0')}` : ''; }
  m = raw.match(/^(\d{4})$/);
  if (m) { const y = Number(m[1]); return y >= 1800 && y <= new Date().getFullYear() + 1 ? String(y) : ''; }
  return '';
}
function validDate(y, mo, d) {
  if (y < 1800 || y > new Date().getFullYear() + 1 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const httpsUrl = value => { const raw = String(value ?? '').trim().slice(0, 1200); if (!raw) return ''; try { const u = new URL(raw); return u.protocol === 'https:' ? u.toString() : null; } catch { return null; } };

/* ───────── استخراج النص من ملف ───────── */
export function decodeTextFile(buffer) {
  let bytes = Buffer.from(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) { const swapped = Buffer.from(bytes.subarray(2)); swapped.swap16(); return new TextDecoder('utf-16le').decode(swapped); }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { try { return new TextDecoder('windows-1256').decode(bytes); } catch { return bytes.toString('latin1'); } }
}
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = value => value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
  if (code[0] === '#') { const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return XML_ENTITIES[code.toLowerCase()] ?? all;
});
/* قراءة جدول ملفات ZIP (الصيغة التي يقوم عليها .docx) دون أي حزمة خارجية. */
export function readZipEntry(buffer, wanted) {
  const buf = Buffer.from(buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('الملف ليس وثيقة Word صالحة (.docx).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), compressed = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('بنية ملف Word تالفة.');
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(start, start + compressed);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 40 * 1024 * 1024 });
      throw new Error('طريقة ضغط غير مدعومة في ملف Word.');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}
export function docxToText(buffer) {
  const xml = readZipEntry(buffer, 'word/document.xml');
  if (!xml) throw new Error('لم يُعثر على متن النص داخل ملف Word.');
  const body = xml.toString('utf8')
    .replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, '\t').replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXml(body).replace(/\t+\n/g, '\n');
}
export function extractFileText(buffer, fileName = '') {
  const name = String(fileName).toLowerCase(), warnings = [];
  let text;
  if (/\.docx$/.test(name)) text = docxToText(buffer);
  else if (/\.(txt|text|md|csv)$/.test(name)) text = decodeTextFile(buffer);
  else if (/\.doc$/.test(name)) throw Object.assign(new Error('صيغة Word القديمة (.doc) غير مدعومة؛ احفظوها بصيغة .docx أو ألصقوا النص.'), { status: 415 });
  else throw Object.assign(new Error('الصيغ المقبولة هنا: .docx و.txt (وPDF يُقرأ في المتصفح). يمكنكم أيضًا لصق النص مباشرة.'), { status: 415 });
  text = cleanText(text);
  if (text.length < 1) warnings.push('لم يُستخرج أي نص من الملف.');
  if (text.length >= LIMITS.textChars) warnings.push('قُصّ النص عند الحد الأقصى المسموح به.');
  return { text, chars: text.length, warnings };
}

/* ───────── الأصول المرفقة: أنواع مقبولة تُتحقق من بصمة البايتات لا من الامتداد وحده ───────── */
export const ORIGINAL_MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain; charset=utf-8' };
export function sniffOriginal(buffer, fileName = '') {
  const b = Buffer.from(buffer.subarray ? buffer.subarray(0, 16) : buffer), name = String(fileName).toLowerCase();
  if (b.length < 4) return null;
  if (b.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b[0] === 0x50 && b[1] === 0x4b && /\.docx$/.test(name)) return 'docx';
  if (/\.(txt|text|md)$/.test(name) && !b.includes(0)) return 'txt';
  return null;
}
export const safeFileName = (value, ext) => {
  const base = String(value || '').normalize('NFC').replace(/[\u0000-\u001f\u007f\\/:*?"<>|\u200e\u200f\u202a-\u202e]+/g, ' ').replace(/(?:^|\s)\.+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/^\.+/, '').trim().slice(0, 120);
  return (base || 'الأصل') + '.' + ext;
};
export const newFileId = () => 'f_' + randomBytes(10).toString('hex');

/* ───────── التحقق من الإدخال ───────── */
export function validateAddition(body, userEmail) {
  const kind = String(body?.kind || '');
  if (!KINDS[kind]) return { error: 'اختاروا نوع الإضافة: نص قانوني أو اجتهاد قضائي أو بحث أو دراسة.' };
  const title = oneLine(body.title, LIMITS.title);
  if (title.length < 3) return { error: 'أدخلوا عنوان الوثيقة (3 أحرف على الأقل).' };
  const issuedAt = normalizeIssuedAt(body.issuedAt);
  if (!issuedAt) return { error: 'أدخلوا تاريخ الإصدار (يوم/شهر/سنة، أو السنة وحدها) بتاريخ صحيح.' };
  const text = cleanText(body.text);
  if (text.length < LIMITS.minTextChars) return { error: 'النص قصير جدًا؛ ألصقوا النص كاملًا أو ارفعوا ملفه.' };
  const source = oneLine(body.source, 300);
  if (source.length < 3) return { error: 'أدخلوا مصدر الوثيقة (مثل: الجريدة الرسمية عدد…، موقع عدالة، مجلة…، أو اسم المحكمة).' };
  let sourceUrl = httpsUrl(body.sourceUrl);
  if (sourceUrl === null) return { error: 'رابط المصدر يجب أن يبدأ بـ https:// أو يُترك فارغًا.' };
  if (!sourceUrl) sourceUrl = httpsUrl(source) || '';
  const record = {
    id: newContributionId(), type: 'addition', kind, title, issuedAt, text, chars: text.length, contentHash: textDigest(text),
    source, reference: oneLine(body.reference, LIMITS.reference), issuer: oneLine(body.issuer, LIMITS.reference), sourceUrl,
    sourceName: oneLine(body.sourceName, 200), note: cleanText(body.note, LIMITS.message),
    fileIds: Array.isArray(body.fileIds) ? [...new Set(body.fileIds.map(v => String(v).slice(0, 40)).filter(v => /^f_[0-9a-f]{20}$/.test(v)))].slice(0, LIMITS.originalsPerItem) : [],
    userEmail, status: 'pending',
  };
  return { record };
}
export function validateNote(body, userEmail, known = null) {
  const noteType = NOTE_TYPES[body?.noteType] ? body.noteType : 'other';
  const message = cleanText(body?.message, LIMITS.message);
  if (message.length < 5) return { error: 'اكتبوا ملاحظتكم (5 أحرف على الأقل).' };
  const documentId = oneLine(body?.documentId, 120);
  if (!documentId) return { error: 'تعذر تحديد الوثيقة المعنية بالملاحظة.' };
  const record = {
    id: newContributionId(), type: 'note', noteType, documentId, documentTitle: oneLine(known?.title || body.documentTitle, LIMITS.title),
    message, excerpt: cleanText(body.excerpt, LIMITS.excerpt), chars: message.length, contentHash: textDigest(documentId + '|' + message),
    userEmail, status: 'pending',
  };
  return { record };
}

/* ───────── التحويل إلى مسودة منشورة لاحقًا ───────── */
export function draftFromContribution(c, documentId) {
  const k = KINDS[c.kind] || KINDS.study;
  const label = c.type === 'addition' ? `إضافة مستخدم · ${k.label}` : '';
  const parts = [];
  if (c.source) parts.push(`المصدر: ${c.source}`);
  if (c.reference) parts.push(`المرجع: ${c.reference}`);
  if (c.issuer) parts.push(`الجهة: ${c.issuer}`);
  return {
    documentId, title: c.title, text: c.text, type: k.type, kind: k.docKind, category: k.category, subcategory: k.subcategory || '',
    date: c.issuedAt || '', textKind: 'extracted_text', sourceUrl: c.sourceUrl || '', sourceLabel: [label, ...parts].filter(Boolean).join(' — ').slice(0, 300) || 'إضافة مستخدم اعتمدتها إدارة المكتبة',
    reason: `إضافة من مستخدم (${c.userEmail}) — ${k.label}`, origin: 'contribution', contributionId: c.id, issuer: c.issuer || '', originalFiles: c.originalFiles || [],
  };
}

/* ───────── وجهة الأصول في Drive: القسم المخصص حسب نوع الوثيقة، أو مجلد جديد بعنوان يحدّده المدير ───────── */
export const DRIVE_SECTIONS = {
  law: { id: 'law', label: 'المواد القانونية', aliases: ['المواد القانونية'] },
  treaty: { id: 'treaty', label: 'الاتفاقيات و المعاهدات', aliases: ['الاتفاقيات و المعاهدات'] },
  jurisprudence: { id: 'jurisprudence', label: 'الاجتهادات القضائية', aliases: ['الاجتهادات القضائية'] },
  research: { id: 'research', label: 'الأبحاث و الدراسات', aliases: ['الأبحاث و الدراسات', 'الأبحات و الدراسات'] },
};
export function originalsSection(doc = {}) {
  if (doc.kind === 'jurisprudence' || doc.type === 'juriscassation') return DRIVE_SECTIONS.jurisprudence;
  if (doc.kind === 'study' || /دراس|أبحاث|بحث/.test(String(doc.category || ''))) return DRIVE_SECTIONS.research;
  if (/اتفاقي|معاهد/.test(String(doc.category || '') + ' ' + String(doc.title || ''))) return DRIVE_SECTIONS.treaty;
  return DRIVE_SECTIONS.law;
}
export const originalDriveName = (doc, ext, index = 0, total = 1) =>
  safeFileName(`${oneLine(doc.sourceLanguage === 'fr' && doc.originalTitle ? doc.originalTitle : doc.title, 140)}${doc.date ? ` (${String(doc.date).slice(0, 10)})` : ''}${total > 1 ? ` - ${index + 1}` : ''}`, ext);

/* ───────── عرض آمن للمستخدم ───────── */
export const userView = c => ({
  id: c.id, type: c.type, kind: c.kind || '', kindLabel: c.kind ? KINDS[c.kind]?.label || '' : (NOTE_TYPES[c.noteType] || ''),
  title: c.type === 'note' ? (c.documentTitle || 'ملاحظة على وثيقة') : c.title, documentId: c.documentId || '', issuedAt: c.issuedAt || '',
  originals: (c.originalFiles || []).length, unread: !!c.userNotifyPending, status: c.status, statusLabel: STATUSES[c.status] || c.status, reply: c.adminReply || '', publishedDocumentId: c.publishedDocumentId || '',
  createdAt: c.createdAt, updatedAt: c.statusChangedAt || c.updatedAt,
});

/* ───────── رسائل البريد ───────── */
const WHAT = c => (c.type === 'note' ? 'ملاحظتكم' : 'إضافتكم');
const WHAT_FR = c => (c.type === 'note' ? 'votre remarque' : 'votre contribution');
export function contributionMail(c, event) {
  const title = c.type === 'note' ? (c.documentTitle || 'وثيقة') : c.title;
  const what = WHAT(c), whatFr = WHAT_FR(c);
  const base = String(process.env.LIBRARY_PUBLIC_URL || 'https://qalam-library.onrender.com').replace(/\/+$/, '');
  const copy = {
    received: { tone: 'info', badgeAr: 'قيد الدرس', badgeFr: 'À l’étude', headAr: `تلقّينا ${what}`, headFr: `Nous avons bien reçu ${whatFr}`, ar: [`«${title}» قيد الدرس لدى إدارة المكتبة.`, 'ستصلكم رسالة أخرى عند اعتمادها أو نشرها، وتجدون حالتها دائمًا في «إضافات» داخل المكتبة.'], fr: [`« ${title} » est à l’étude auprès de l’administration de la bibliothèque.`, 'Vous recevrez un nouveau message lors de son approbation ou de sa publication.'] },
    published: { tone: 'success', badgeAr: 'منشورة', badgeFr: 'Publiée', headAr: `اعتُمدت ${what} ونُشرت`, headFr: `${whatFr[0].toUpperCase()}${whatFr.slice(1)} est publiée`, ar: [`اعتمدت إدارة المكتبة «${title}» ونشرتها لقراء المكتبة.`, 'شكرًا لإسهامكم.'], fr: [`L’administration a approuvé et publié « ${title} ».`, 'Merci pour votre contribution.'] },
    accepted: { tone: 'success', badgeAr: 'معتمدة', badgeFr: 'Approuvée', headAr: `اعتُمدت ${what}`, headFr: `${whatFr[0].toUpperCase()}${whatFr.slice(1)} est approuvée`, ar: [`اعتمدت إدارة المكتبة ملاحظتكم على «${title}».`, 'شكرًا لإسهامكم.'], fr: [`L’administration a approuvé votre remarque sur « ${title} ».`, 'Merci pour votre contribution.'] },
    declined: { tone: 'warning', badgeAr: 'لم تُعتمد', badgeFr: 'Non retenue', headAr: `نتيجة دراسة ${what}`, headFr: `Résultat de l’examen de ${whatFr}`, ar: [`درست إدارة المكتبة «${title}» ولم تعتمدها في هذه المرحلة.`], fr: [`L’administration a examiné « ${title} » et ne l’a pas retenue pour l’instant.`] },
    reviewing: { tone: 'info', badgeAr: 'قيد المراجعة', badgeFr: 'En révision', headAr: `${what} قيد المراجعة والتحرير`, headFr: `${whatFr[0].toUpperCase()}${whatFr.slice(1)} est en cours de révision`, ar: [`بدأت إدارة المكتبة مراجعة «${title}» وتحرير نصها قبل اعتمادها.`], fr: [`L’administration a commencé la révision de « ${title} » avant son approbation.`] },
  }[event];
  if (!copy) return null;
  const reply = c.adminReply ? [`ردّ الإدارة: ${c.adminReply}`] : [];
  const replyFr = c.adminReply ? [`Réponse de l’administration : ${c.adminReply}`] : [];
  const text = renderEmailText({ headingAr: copy.headAr, bodyLinesAr: [...copy.ar, ...reply, base], headingFr: copy.headFr, bodyLinesFr: [...copy.fr, ...replyFr, base] });
  const html = renderEmailHtml({
    tone: copy.tone, badgeAr: copy.badgeAr, badgeFr: copy.badgeFr, headingAr: copy.headAr, headingFr: copy.headFr, preheader: title,
    bodyHtmlAr: paragraphs([...copy.ar, ...reply]) + actionButton(base, 'فتح المكتبة'),
    bodyHtmlFr: paragraphs([...copy.fr, ...replyFr]) + actionButton(base, 'Ouvrir la bibliothèque'),
  });
  return { subject: `${copy.headAr} — المكتبة الرقمية`, text, html };
}
export function ownerContributionMail(c) {
  const isNote = c.type === 'note', label = isNote ? 'ملاحظة جديدة من مستخدم' : `إضافة جديدة من مستخدم (${KINDS[c.kind]?.label || ''})`;
  const title = isNote ? (c.documentTitle || c.documentId) : c.title;
  const lines = [`العنوان: ${title}`, `المستخدم: ${c.userEmail}`, ...(isNote ? [`نوع الملاحظة: ${NOTE_TYPES[c.noteType] || ''}`] : [`تاريخ الإصدار: ${c.issuedAt}`]), 'تجدونها في لوحة الإدارة ← إضافات وملاحظات المستخدمين.'];
  const text = renderEmailText({ headingAr: label, bodyLinesAr: lines, headingFr: 'Nouvelle contribution d’un utilisateur', bodyLinesFr: [`${title} — ${c.userEmail}`] });
  const html = renderEmailHtml({ tone: 'info', badgeAr: 'إشعار للإدارة', badgeFr: 'Notification administrative', headingAr: label, headingFr: 'Nouvelle contribution d’un utilisateur', preheader: title, bodyHtmlAr: paragraphs(lines), bodyHtmlFr: paragraphs([`${title} — ${c.userEmail}`]) });
  return { subject: `${label} — المكتبة الرقمية`, text, html };
}
