/* تطبيق نصوص رسمية موثّقة المصدر على وثائق سُحب نصها الخاطئ (data/supplied-texts/manifest.json).
   الاستعمال: node tools/apply-supplied-texts.mjs data/library.sqlite — يُشغَّل بعد curate-library. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { normalizeSearch } from '../src/text.mjs';

const file = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || 'data/library.sqlite';
const dir = new URL('../data/supplied-texts/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', dir), 'utf8'));
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=DELETE;');
const columns = new Set(db.prepare('PRAGMA table_info(documents)').all().map(c => c.name));
const read = db.prepare('SELECT rowid,id,title,body FROM documents WHERE id=?');
const ftsDelete = db.prepare("INSERT INTO search(search,rowid,title,body) VALUES('delete',?,?,?)");
const ftsInsert = db.prepare('INSERT INTO search(rowid,title,body) VALUES(?,?,?)');
let applied = 0;
db.exec('BEGIN');
try {
  for (const [id, item] of Object.entries(manifest)) {
    const row = read.get(id);
    if (!row) continue;
    const text = fs.readFileSync(new URL(item.file, dir), 'utf8').trim();
    const old = brotliDecompressSync(Buffer.from(row.body)).toString('utf8');
    if (old === text) continue;
    for (const value of new Set([old, normalizeSearch(old)])) { try { ftsDelete.run(row.rowid, row.title, value); } catch {} try { ftsDelete.run(row.rowid, normalizeSearch(row.title), value); } catch {} }
    const sets = ['body=?', 'sha256=?', 'chars=?', "text_kind='extracted_text'"], args = [brotliCompressSync(Buffer.from(text, 'utf8')), createHash('sha256').update(text).digest('hex'), text.length];
    if (columns.has('source_label') && item.sourceLabel) { sets.push('source_label=?'); args.push(item.sourceLabel); }
    db.prepare(`UPDATE documents SET ${sets.join(',')} WHERE rowid=?`).run(...args, row.rowid);
    ftsInsert.run(row.rowid, normalizeSearch(row.title), normalizeSearch(text));
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='headings'").get()) db.prepare('DELETE FROM headings WHERE doc_rowid=?').run(row.rowid);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='curation_text_withdrawn'").get()) db.prepare('DELETE FROM curation_text_withdrawn WHERE id=?').run(id);
    applied++;
  }
  db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('generation', JSON.stringify(Date.now()));
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
console.log(JSON.stringify({ file, applied }));
