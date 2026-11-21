import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTrashEntry, trashView, restoreTrashEntry, TRASH_RETENTION_MS } from '../src/trash.mjs';

const memory = () => { const rows = new Map(); return {
  rows,
  async replaceOne(filter, doc) { rows.set(filter._id, doc); },
  async deleteOne(filter) { rows.delete(filter._id); },
}; };

test('لقطة الحذف تحفظ البطاقة ومحتواها وتنتهي بعد 30 يوماً', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  const e = makeTrashEntry({ kind: 'monitor', label: 'قرار', item: { _id: 'm1', state: 'published' }, contents: [{ _id: 'c1', status: 'published', category: 'القضاء الدستوري' }] }, now);
  assert.equal(e.purgeAt.getTime() - now.getTime(), TRASH_RETENTION_MS);
  const v = trashView(e);
  assert.equal(v.publishedCount, 1); assert.equal(v.category, 'القضاء الدستوري'); assert.ok(!('contents' in v));
  assert.throws(() => makeTrashEntry({ kind: 'user' }));
});

test('الاستعادة تعيد البطاقة بحالتها الأصلية ومادتها المنشورة وتفرغ السلة', async () => {
  const store = { legalMonitorItems: memory(), content: memory(), trash: memory() };
  const item = { _id: 'm1', state: 'published', title: 'قرار' };
  const e = makeTrashEntry({ kind: 'monitor', label: 'قرار', item, contents: [{ _id: 'c1', status: 'published' }] });
  store.legalMonitorItems.rows.set('m1', { _id: 'm1', state: 'dismissed' }); store.trash.rows.set(e._id, e);
  const r = await restoreTrashEntry(store, e);
  assert.equal(r.restored, true);
  assert.equal(store.legalMonitorItems.rows.get('m1').state, 'published');
  assert.equal(store.content.rows.get('c1').status, 'published');
  assert.equal(store.trash.rows.size, 0);
});

test('حذف بطاقة المستجدات يمر بالسلة قبل المحو', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const block = server.slice(server.indexOf("else if(action==='delete'){"), server.indexOf("}else return send(req,res,400,{error:'إجراء غير معروف.'});"));
  assert.ok(block.indexOf('adminStore.trash.insertOne') > -1 && block.indexOf('adminStore.trash.insertOne') < block.indexOf('adminStore.content.deleteMany'));
});

test('«نصوص التحيين» فرع مستقل يراه الجميع وأدوات النقل للمدير وحده', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('<h3 class="category-group">نصوص التحيين</h3>'));
  assert.ok(!/state\.canAdmin\) rows\.push\('<button type="button" class="category-button" data-drive-folder="14fPme5j1TWFO458B9N-8N93X7w2yt-3W"/.test(app));
  assert.ok(app.includes('if(id===UPDATES_FOLDER_ID&&state.canAdmin)attachUpdatesAdmin(pane);'));
});
