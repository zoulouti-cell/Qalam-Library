import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Library } from '../src/library.mjs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('وضع القارئ: ملف الحساب يعيد دور القارئ فتختفي أدوات المدير', () => {
  assert.ok(server.includes("role:current.viewAsReader?'reader':user.role"));
  assert.ok(app.includes("if (data.role === 'admin' && !state.isAdmin)"));
});

test('أدوات الحذف والنقل على كل البطاقات: وثائق القاعدة وملفات رفوف Drive', () => {
  assert.ok(app.includes('return adminDocTools(doc);') && app.includes('data-doc-hide=') && app.includes('data-doc-move='));
  assert.ok(app.includes('attachDriveAdmin(pane, name);') && app.includes('data-drive-trash=') && app.includes('data-drive-move='));
  for (const route of ["p==='/api/admin/document-action'", "p==='/api/admin/drive-action'", "p==='/api/admin/drive-targets'"]) assert.ok(server.includes(route), route);
  assert.ok(server.includes("makeTrashEntry({kind:'document'") && server.includes("makeTrashEntry({kind:'drive'"));
});

test('المكتبة تحترم قرارات الإخفاء والنقل', () => {
  const lib = Object.create(Library.prototype);
  lib.searchCache = new Map();
  lib.setDocOverrides([{ _id: 'a', hidden: true }, { _id: 'b', category: 'نصوص عامة' }]);
  assert.deepEqual(lib.hiddenIds(), ['a']);
  assert.equal(lib.categoryOf({ id: 'b', type: 'national', title: 'x', category: 'قديم' }), 'نصوص عامة');
  const { clauses, values } = lib.filters({});
  assert.ok(clauses[0].includes('NOT IN') && values[0] === '["a"]');
});
