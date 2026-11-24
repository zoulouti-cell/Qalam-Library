import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFolders, exportFolder, MAX_FOLDERS } from '../src/research-folders.mjs';

test('إنشاء ملف بحث وإضافة عناصر دون تكرار وترتيبها وحذفها', () => {
  let r = applyFolders([], { action: 'create', name: ' التطليق للشقاق ' });
  assert.equal(r.folders[0].name, 'التطليق للشقاق');
  const fid = r.folder.id;
  r = applyFolders(r.folders, { action: 'add', folderId: fid, item: { docId: 'national:118', title: 'مدونة الأسرة', quote: 'المادة 94' } });
  r = applyFolders(r.folders, { action: 'add', folderId: fid, item: { docId: 'national:118', title: 'مدونة الأسرة', quote: 'المادة 94' } });
  assert.equal(r.duplicate, true);
  r = applyFolders(r.folders, { action: 'add', folderId: fid, item: { docId: 'juriscassation:5', title: 'قرار' } });
  const [a, b] = r.folder.items;
  r = applyFolders(r.folders, { action: 'move', folderId: fid, itemId: b.id, dir: 'up' });
  assert.deepEqual(r.folder.items.map(x => x.id), [b.id, a.id]);
  r = applyFolders(r.folders, { action: 'note', folderId: fid, itemId: a.id, note: 'أساس الطلب' });
  assert.equal(r.folder.items[1].note, 'أساس الطلب');
  r = applyFolders(r.folders, { action: 'removeItem', folderId: fid, itemId: b.id });
  assert.equal(r.folder.items.length, 1);
  assert.equal(applyFolders(r.folders, { action: 'remove', id: fid }).folders.length, 0);
});

test('يرفض المعرّف غير الصالح والزائد عن الحد', () => {
  const { folders, folder } = applyFolders([], { action: 'create', name: 'س' });
  assert.ok(applyFolders(folders, { action: 'add', folderId: folder.id, item: { docId: '<x>' } }).error);
  const many = Array.from({ length: MAX_FOLDERS }, (_, i) => ({ id: 'f' + i, name: 'f', items: [] }));
  assert.ok(applyFolders(many, { action: 'create', name: 'جديد' }).error);
});

test('التصدير يهرّب النصوص ويضع نص الوثيقة أو المقطع', () => {
  const html = exportFolder({ name: '<b>بحث</b>', items: [{ docId: 'national:31', title: 'ق.ل.ع', quote: '', note: 'x<y', citation: '' }] }, { texts: { 'national:31': 'الفصل 230' }, word: true });
  assert.match(html, /dir="rtl"/);
  assert.match(html, /الفصل 230/);
  assert.doesNotMatch(html, /<b>بحث|x<y|<script/);
});
