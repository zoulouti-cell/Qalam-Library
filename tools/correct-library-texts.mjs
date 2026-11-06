import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { normalizeSearch } from '../src/text.mjs';

const file = process.argv[2] || 'data/library.sqlite';
const curation = JSON.parse(fs.readFileSync(new URL('../data/judicial-curation.json', import.meta.url))).entries || {};
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=DELETE;');
const corrections = new Map([
  ['national:32', text => text
    .replace(/قانون\s+المسطرة\s+لا\s*مدنية/gu, 'قانون المسطرة المدنية')
    .replace(/ملا\s*تعلق\s*\n\s*بالمسطرة\s*المدنية/gu, 'المتعلق بالمسطرة المدنية')
    .replace(/لا\s*متعلق\s*\n\s*بالـ?مسطرة\s*\n\s*المدنية/gu, 'المتعلق بالمسطرة المدنية')],
  ['national:90', text => text.replace(/ظهير\s+شريف\s+رقم\s*1\.02\.255/gu, 'ظهير شريف رقم 1.02.255')],
]);
const update = db.prepare('UPDATE documents SET body=?,sha256=?,chars=? WHERE rowid=?');
const deleteFts = db.prepare("INSERT INTO search(search,rowid,title,body) VALUES('delete',?,?,?)");
const insertFts = db.prepare('INSERT INTO search(rowid,title,body) VALUES(?,?,?)');
let fixedNational = 0, fixedRuleHeaders = 0;
let fixedRuleContinuation = 0;
db.exec('BEGIN');
try {
  for (const [id, correct] of corrections) {
    const row = db.prepare('SELECT rowid,id,title,body FROM documents WHERE id=?').get(id);
    if (!row) continue;
    const oldText = brotliDecompressSync(row.body).toString('utf8');
    const text = correct(oldText);
    if (text === oldText) continue;
    deleteFts.run(row.rowid, normalizeSearch(row.title), normalizeSearch(oldText));
    update.run(brotliCompressSync(Buffer.from(text), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }), createHash('sha256').update(text).digest('hex'), text.length, row.rowid);
    insertFts.run(row.rowid, normalizeSearch(row.title), normalizeSearch(text));
    fixedNational++;
  }

  const rules = Object.entries(curation).filter(([, item]) => item?.category === 'قواعد قضائية').map(([id]) => id);
  const read = db.prepare('SELECT rowid,id,title,body FROM documents WHERE id=?');
  for (const id of rules) {
    const row = read.get(id);
    if (!row) continue;
    const oldText = brotliDecompressSync(row.body).toString('utf8');
    const text = oldText.replace(/^\s*(?:قرار\s+(?:رقم|عدد)\s*[:：]?\s*[0-9٠-٩/.-]*\s*)?(?:ملف\s+(?:رقم|عدد)\s*[:：]?\s*[0-9٠-٩/.-]*\s*)+\r?\n\s*/u, '');
    if (text === oldText) continue;
    deleteFts.run(row.rowid, normalizeSearch(row.title), normalizeSearch(oldText));
    update.run(brotliCompressSync(Buffer.from(text), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }), createHash('sha256').update(text).digest('hex'), text.length, row.rowid);
    insertFts.run(row.rowid, normalizeSearch(row.title), normalizeSearch(text));
    fixedRuleHeaders++;
  }

  const continuationRow = read.get('jc:35266');
  if (continuationRow) {
    const oldText = brotliDecompressSync(continuationRow.body).toString('utf8');
    const correctedContinuation = 'وتشمل الأخطاء المادية التي تمس تنفيذ الأوامر، دون التأثير على الأساس القانوني للقرار.';
    const text = oldText
      .replace('بما في ذلك الأخطاء المادية التي تمس تنفيذ الأوامر، دون التأثير على الأساس القانوني للقرار.', correctedContinuation)
      .replace('ويشمل ذلك تصحيح الأخطاء المادية المتصلة بتنفيذ الأوامر، شريطة ألا يمس التصحيح الأساس القانوني للقرار.', correctedContinuation)
      .replace('وتشمل هذه الصعوبات الأخطاء المادية التي تمس تنفيذ الأوامر، على ألا يترتب على تصحيحها أي تأثير في الأساس القانوني للقرار.', correctedContinuation);
    if (text !== oldText) {
      deleteFts.run(continuationRow.rowid, normalizeSearch(continuationRow.title), normalizeSearch(oldText));
      update.run(brotliCompressSync(Buffer.from(text), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }), createHash('sha256').update(text).digest('hex'), text.length, continuationRow.rowid);
      insertFts.run(continuationRow.rowid, normalizeSearch(continuationRow.title), normalizeSearch(text));
      fixedRuleContinuation++;
    }
  }
  db.exec('COMMIT');
  console.log(JSON.stringify({ fixedNational, fixedRuleHeaders, fixedRuleContinuation }));
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
