/* قاعدة مكتبة تجريبية صغيرة (وثائق صناعية) لتشغيل الخادم في الاختبارات دون قاعدة الإنتاج. */
import { DatabaseSync } from 'node:sqlite';
import { brotliCompressSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

export function makeLibraryDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE documents(id TEXT PRIMARY KEY,title TEXT,title_norm TEXT,type TEXT,category TEXT,subcategory TEXT,kind TEXT,date TEXT,text_kind TEXT,review_status TEXT,issues TEXT,law_number TEXT,decision_number TEXT,case_number TEXT,abrogated INTEGER DEFAULT 0,sha256 TEXT,body BLOB,source_url TEXT,source_label TEXT,chars INTEGER DEFAULT 0);
    CREATE VIRTUAL TABLE search USING fts5(title,body,content='',tokenize='unicode61');
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE law_titles(id TEXT PRIMARY KEY,original_title TEXT,display_title TEXT,number TEXT,basis TEXT);
    CREATE TABLE reading_audit(id TEXT PRIMARY KEY,assessment TEXT);
    CREATE TABLE terms(term TEXT PRIMARY KEY,count INTEGER);
    CREATE TABLE vocabulary(term TEXT PRIMARY KEY,doc INTEGER);
    CREATE TABLE original_sequence(doc_id TEXT PRIMARY KEY,position INTEGER NOT NULL);
    CREATE TABLE catalog_order(doc_rowid INTEGER PRIMARY KEY,position INTEGER NOT NULL);
  `);
  const docs = [
    ['law_fixture_1', 'قانون تجريبي رقم 01.01 بشأن الاختبار', 'national', 'المواد القانونية', 'law', '2020-01-01', 'المادة 1\nيسري هذا القانون على جميع الوثائق التجريبية المعتمدة في المكتبة.\nالمادة 2\nتُحدَّد كيفيات التطبيق بنص تنظيمي.'],
    ['judge_fixture_1', 'قرار تجريبي عدد 100 بتاريخ 2021-03-04', 'judicial', 'اجتهادات المحاكم', 'jurisprudence', '2021-03-04', 'قرار تجريبي صادر عن محكمة الاستئناف، يتعلق بالتعويض عن الضرر وفق قواعد المسؤولية.'],
  ];
  const put = db.prepare('INSERT INTO documents(id,title,title_norm,type,category,subcategory,kind,date,text_kind,review_status,issues,law_number,decision_number,case_number,abrogated,sha256,body,chars) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)');
  const idx = db.prepare('INSERT INTO search(rowid,title,body) VALUES(?,?,?)');
  docs.forEach(([id, title, type, category, kind, date, text], i) => {
    put.run(id, title, title, type, category, '', kind, date, 'extracted_text', 'human_verified', '[]', '', '', '', 'f'.repeat(64), brotliCompressSync(Buffer.from(text, 'utf8')), text.length);
    idx.run(i + 1, title, text);
  });
  const meta = { version: 'fixture', generation: 1, documents: docs.length, extractedText: docs.length, needsReview: 0, automatedReview: 0, originalCategories: [] };
  const m = db.prepare('INSERT INTO metadata VALUES(?,?)');
  for (const [k, v] of Object.entries(meta)) m.run(k, JSON.stringify(v));
  db.close();
  return file;
}
