import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIssuedAt, validateAddition, validateNote, sniffOriginal, safeFileName, newFileId, originalsSection, originalDriveName,
  draftFromContribution, userView, extractFileText, LIMITS,
} from '../src/contributions.mjs';

/* ───────── وحدات صرفة ───────── */
test('تاريخ الإصدار: صيغ مقبولة وتواريخ مستحيلة مرفوضة', () => {
  assert.equal(normalizeIssuedAt('04/03/2021'), '2021-03-04');
  assert.equal(normalizeIssuedAt('٠٤-٠٣-٢٠٢١'), '2021-03-04');
  assert.equal(normalizeIssuedAt('2021'), '2021');
  assert.equal(normalizeIssuedAt('2021-03'), '2021-03');
  assert.equal(normalizeIssuedAt('31/02/2021'), '');
  assert.equal(normalizeIssuedAt('1700'), '');
  assert.equal(normalizeIssuedAt(''), '');
});

test('إضافة صالحة: المصدر إلزامي والأصول تُنقّى من المعرّفات غير الصحيحة', () => {
  const body = { kind: 'study', title: 'دراسة في المسؤولية', issuedAt: '2022', text: 'ن'.repeat(200), source: 'مجلة المحاكم', fileIds: ['f_' + 'a'.repeat(20), 'bad', 'f_xyz', 'f_' + 'a'.repeat(20)] };
  const ok = validateAddition(body, 'a@b.co');
  assert.ok(ok.record, JSON.stringify(ok));
  assert.deepEqual(ok.record.fileIds, ['f_' + 'a'.repeat(20)]);
  assert.match(validateAddition({ ...body, source: '' }, 'a@b.co').error, /مصدر/);
  assert.match(validateAddition({ ...body, kind: 'x' }, 'a@b.co').error, /نوع/);
  assert.match(validateAddition({ ...body, issuedAt: '99/99/2020' }, 'a@b.co').error, /تاريخ/);
  assert.match(validateAddition({ ...body, text: 'قصير' }, 'a@b.co').error, /قصير/);
  assert.match(validateAddition({ ...body, sourceUrl: 'http://x.ma' }, 'a@b.co').error, /https/);
});

test('ملاحظة: تحتاج نصًا كافيًا ووثيقة معنية', () => {
  assert.ok(validateNote({ documentId: 'd1', message: 'يوجد خطأ في المادة الثانية' }, 'a@b.co', { title: 'قانون' }).record);
  assert.ok(validateNote({ documentId: 'd1', message: 'خطأ' }, 'a@b.co').error);
  assert.ok(validateNote({ message: 'ملاحظة طويلة بما يكفي' }, 'a@b.co').error);
});

test('الأصول: التعرف على النوع من بصمة البايتات لا من الامتداد', () => {
  assert.equal(sniffOriginal(Buffer.from('%PDF-1.7 ....'), 'x.pdf'), 'pdf');
  assert.equal(sniffOriginal(Buffer.from('%PDF-1.7 ....'), 'x.exe'), 'pdf');
  assert.equal(sniffOriginal(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), 'a.jpg'), 'jpg');
  assert.equal(sniffOriginal(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'a.png'), 'png');
  assert.equal(sniffOriginal(Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]), 'a.webp'), 'webp');
  assert.equal(sniffOriginal(Buffer.from([0x50, 0x4b, 3, 4, 0, 0]), 'نص.docx'), 'docx');
  assert.equal(sniffOriginal(Buffer.from([0x50, 0x4b, 3, 4, 0, 0]), 'archive.zip'), null);
  assert.equal(sniffOriginal(Buffer.from('نص عادي', 'utf8'), 'n.txt'), 'txt');
  assert.equal(sniffOriginal(Buffer.from('MZ\x90\x00\x03\x00'), 'virus.exe'), null);
  assert.equal(sniffOriginal(Buffer.from('<html><script>'), 'x.html'), null);
  assert.equal(sniffOriginal(Buffer.alloc(2), 'x.pdf'), null);
});

test('اسم الملف الآمن ومعرّفه', () => {
  assert.equal(safeFileName('../../etc/passwd.pdf', 'pdf'), 'etc passwd.pdf');
  assert.equal(safeFileName('', 'png'), 'الأصل.png');
  assert.ok(!/[\\/:*?"<>|]/.test(safeFileName('a<b>:c|d?.pdf', 'pdf')));
  assert.match(newFileId(), /^f_[0-9a-f]{20}$/);
});

test('قسم Drive المخصص حسب نوع الوثيقة وتسمية الملفات', () => {
  assert.equal(originalsSection({ kind: 'law', category: 'نصوص عامة' }).id, 'law');
  assert.equal(originalsSection({ kind: 'law', category: 'الاتفاقيات الدولية' }).id, 'treaty');
  assert.equal(originalsSection({ kind: 'jurisprudence', category: 'اجتهادات المحاكم' }).id, 'jurisprudence');
  assert.equal(originalsSection({ kind: 'study', category: 'أبحاث ودراسات' }).id, 'research');
  assert.equal(originalsSection({ pendingCassation: true }).id, 'cassation-pending');
  assert.equal(originalsSection({ kind: 'update', country: 'ma' }).id, 'updates');
  assert.equal(originalsSection({ country: 'fr', kind: 'decision' }).id, 'french');
  assert.equal(originalDriveName({ title: 'دراسة في التحكيم', date: '2022-05-01' }, 'pdf'), 'دراسة في التحكيم (2022-05-01).pdf');
  assert.equal(originalDriveName({ title: 'قرار', date: '' }, 'jpg', 1, 3), 'قرار - 2.jpg');
});

test('المسودة المشتقة تحمل الأصول والمصدر، وعرض المستخدم لا يسرّب النص', () => {
  const c = { id: 'c_1', type: 'addition', kind: 'jurisprudence', title: 'قرار', text: 'نص كامل سري', issuedAt: '2021-03-04', source: 'المحكمة', issuer: 'محكمة النقض', userEmail: 'a@b.co', status: 'pending', originalFiles: [{ id: 'f_' + '1'.repeat(20), name: 'x.pdf', ext: 'pdf', size: 10 }] };
  const d = draftFromContribution(c, 'managed_x');
  assert.equal(d.origin, 'contribution'); assert.equal(d.contributionId, 'c_1'); assert.equal(d.issuer, 'محكمة النقض'); assert.equal(d.originalFiles.length, 1);
  assert.match(d.sourceLabel, /المصدر: المحكمة/);
  const v = userView(c);
  assert.equal(v.originals, 1); assert.ok(!JSON.stringify(v).includes('نص كامل سري')); assert.ok(!('userEmail' in v));
});

test('استخراج النص من ملف نصي بترميزات شائعة', () => {
  const r = extractFileText(Buffer.from('﻿المادة 1\nنص عربي', 'utf8'), 'a.txt');
  assert.match(r.text, /المادة 1/);
  assert.throws(() => extractFileText(Buffer.from([0, 1, 2, 3]), 'a.bin'));
  assert.ok(LIMITS.originalBytes >= 8 * 1024 * 1024);
});

import { judicialFolderIdFor } from '../src/drive.mjs';
test('محاكم لها مجلد مخصص في Drive تُعرَّف بالاسم وغيرها لا', () => {
  assert.ok(judicialFolderIdFor('محكمة النقض'));
  assert.ok(judicialFolderIdFor('قرار صادر عن محكمة النقض الغرفة المدنية'));
  assert.equal(judicialFolderIdFor('محكمة ابتدائية بمدينة ما'), '');
  assert.equal(judicialFolderIdFor(''), '');
});
