import { randomBytes } from 'node:crypto';

/* سلة المحذوفات على مستوى المكتبة: كل حذف إداري يحفظ لقطة كاملة لما حُذف (السجل والمحتوى المنشور المرتبط به)،
   فيُستعاد كما كان بزر واحد، ولا يُمحى نهائياً إلا بعد 30 يوماً (فهرس TTL على purgeAt) أو بأمر المدير. */
export const TRASH_RETENTION_MS = 30 * 24 * 3600 * 1000;

export const TRASH_KINDS = {
  monitor: 'بطاقة مستجدات',
};

export function makeTrashEntry({ kind, label, actor = 'admin', item = null, contents = [] }, now = new Date()) {
  if (!TRASH_KINDS[kind]) throw new Error('نوع محذوف غير معروف.');
  return {
    _id: 'trash_' + randomBytes(9).toString('base64url'),
    kind,
    label: String(label || '').slice(0, 300) || TRASH_KINDS[kind],
    item,
    contents: Array.isArray(contents) ? contents : [],
    deletedBy: String(actor || 'admin').slice(0, 120),
    deletedAt: now,
    purgeAt: new Date(now.getTime() + TRASH_RETENTION_MS),
  };
}

/* عرض مختصر للقائمة: لا يُرسل النص الكامل إلى المتصفح. */
export function trashView(entry = {}) {
  return {
    id: entry._id,
    kind: entry.kind,
    kindLabel: TRASH_KINDS[entry.kind] || entry.kind,
    label: entry.label,
    deletedBy: entry.deletedBy,
    deletedAt: entry.deletedAt,
    purgeAt: entry.purgeAt,
    publishedCount: (entry.contents || []).filter(c => c.status === 'published').length,
    category: entry.contents?.[0]?.category || entry.item?.publishCategory || '',
  };
}

/* الاستعادة: يعود السجل كما كان قبل الحذف (بحالته الأصلية) ويعود محتواه المنشور، ثم تُحذف اللقطة من السلة. */
export async function restoreTrashEntry(store, entry) {
  if (!entry) throw new Error('العنصر غير موجود في السلة.');
  if (entry.kind === 'monitor') {
    if (!entry.item?._id) throw new Error('لقطة البطاقة ناقصة.');
    await store.legalMonitorItems.replaceOne({ _id: entry.item._id }, entry.item, { upsert: true });
  }
  for (const doc of entry.contents || []) {
    if (doc?._id) await store.content.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }
  await store.trash.deleteOne({ _id: entry._id });
  return { restored: true, kind: entry.kind, contents: (entry.contents || []).length };
}
