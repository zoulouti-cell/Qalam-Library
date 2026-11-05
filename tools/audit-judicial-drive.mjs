import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const reportDir = process.argv[2] || path.resolve(root, '../adala/reports');
const originalPath = process.argv[3];
if (!originalPath) throw new Error('Pass the original jc-index.json path as the second argument.');
const originalById = new Map(JSON.parse(fs.readFileSync(originalPath, 'utf8')).map(row => [String(row.qalam_id || ''), row]));
const snapshot = 'judicial-drive-inventory.jsonl';
const parts = fs.existsSync(path.join(reportDir, snapshot)) ? [snapshot] : fs.readdirSync(reportDir).filter(name => /^drive-audit-part-\d+\.jsonl$/.test(name)).sort();
if (!parts.length) throw new Error('No Drive inventory parts found.');
const inventory = parts.flatMap(name => fs.readFileSync(path.join(reportDir, name), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)));
const indexed = JSON.parse(brotliDecompressSync(fs.readFileSync(path.join(root, 'data/judicial-index.json.br')))).rows;
const courtName = court => String(court || '').normalize('NFC');
const fileName = name => String(name || '').trim().normalize('NFC');
const exact = new Map(), byNumber = new Map(), allByNumber = new Map();
for (const [court, originalName, driveId] of inventory) {
  const name = fileName(originalName), key = `${courtName(court)}\t${name}`;
  if (!exact.has(key)) exact.set(key, []);
  exact.get(key).push(driveId);
  const number = name.match(/^(\d+)(?=[_.-])/u)?.[1];
  if (!number) continue;
  const courtKey = `${courtName(court)}\t${number}`;
  if (!byNumber.has(courtKey)) byNumber.set(courtKey, []);
  byNumber.get(courtKey).push({ court, name, driveId });
  if (!allByNumber.has(number)) allByNumber.set(number, []);
  allByNumber.get(number).push({ court, name, driveId });
}
const csv = value => '"' + String(value ?? '').replaceAll('"', '""').replaceAll(/\r?\n/g, ' ') + '"';
const detail = [], used = new Set(), byCourt = {}, examples = {}, verifiedDriveIds = {};
for (const [number, court, title, date, decisionNumber, caseNumber, expectedName] of indexed) {
  const original = originalById.get(`jc:${number}`);
  const expected = fileName(expectedName), key = `${courtName(court)}\t${expected}`;
  const exactMatches = exact.get(key) || [];
  const numericMatches = byNumber.get(`${courtName(court)}\t${number}`) || [];
  const elsewhere = (allByNumber.get(String(number)) || []).filter(file => file.court !== court);
  let status, matches;
  if (exactMatches.length === 1) { status = original?.file_name ? 'exact_indexed_name' : 'matched_by_id_filename'; matches = [{ court, name: expected, driveId: exactMatches[0] }]; }
  else if (exactMatches.length > 1) { status = 'duplicate_exact'; matches = exactMatches.map(driveId => ({ court, name: expected, driveId })); }
  else if (numericMatches.length === 1) { status = 'renamed_same_court'; matches = numericMatches; }
  else if (numericMatches.length > 1) { status = 'ambiguous_same_court'; matches = numericMatches; }
  else if (elsewhere.length) { status = 'other_court_id'; matches = elsewhere; }
  else { status = 'not_in_court_folders'; matches = []; }
  for (const match of matches) used.add(match.driveId);
  if ((status === 'exact_indexed_name' || status === 'matched_by_id_filename') && matches.length === 1) verifiedDriveIds[`jc:${number}`] = matches[0].driveId;
  const counts = byCourt[court] ||= { indexed: 0, exact_indexed_name: 0, matched_by_id_filename: 0, duplicate_exact: 0, renamed_same_court: 0, ambiguous_same_court: 0, other_court_id: 0, not_in_court_folders: 0 };
  counts.indexed++; counts[status]++;
  if (!examples[status]) examples[status] = [];
  if (examples[status].length < 8) examples[status].push({ id: `jc:${number}`, court, expected, matches: matches.slice(0, 3) });
  detail.push([`jc:${number}`, court, status, fileName(original?.file_name), expected, matches.map(x => `${x.court}/${x.name}`).join(' | '), matches.map(x => x.driveId).join(' | '), title, date, decisionNumber, caseNumber, original?.['المصدر'] || '', original?.['pdf_المصدر'] || '', original?.['نص_في_المكتبة'] || '']);
}
const extra = inventory.filter(row => !used.has(row[2]));
const total = Object.values(byCourt).reduce((acc, group) => {
  for (const [key, value] of Object.entries(group)) acc[key] = (acc[key] || 0) + value;
  return acc;
}, {});
const unresolved = detail.filter(row => row[2] === 'not_in_court_folders');
const report = { generatedAt: new Date().toISOString(), basis: 'Google Drive PDF metadata in the six verified issuing-court folders versus the original jc-index.json', drivePdfFiles: inventory.length, drivePdfByCourt: Object.fromEntries([...new Set(inventory.map(row => row[0]))].map(court => [court, inventory.filter(row => row[0] === court).length])), total, byCourt, driveFilesNotUsed: extra.length, unresolvedWithIndexedPdfUrl: unresolved.filter(row => row[12]).length, unresolvedWithLibraryText: unresolved.filter(row => row[13] === 'نعم').length, examples };
fs.writeFileSync(path.join(reportDir, 'judicial-drive-audit-summary.json'), JSON.stringify(report, null, 2));
const headers = ['id','court','status','indexed_file_name','searched_file_name','drive_file','drive_id','title','date','decision_number','case_number','source_url','indexed_pdf_url','text_in_library'];
fs.writeFileSync(path.join(reportDir, 'judicial-drive-audit-detail.csv'), '\uFEFF' + headers.join(',') + '\n' + detail.map(row => row.map(csv).join(',')).join('\n'));
fs.writeFileSync(path.join(reportDir, 'judicial-drive-unresolved.csv'), '\uFEFF' + headers.join(',') + '\n' + unresolved.map(row => row.map(csv).join(',')).join('\n'));
fs.writeFileSync(path.join(reportDir, 'judicial-drive-unmatched-files.csv'), '\uFEFFcourt,file_name,drive_id\n' + extra.map(row => row.map(csv).join(',')).join('\n'));
fs.writeFileSync(path.join(root, 'data/judicial-drive-map.json.br'), brotliCompressSync(Buffer.from(JSON.stringify({ version: 1, generatedAt: report.generatedAt, ids: verifiedDriveIds })), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }));
console.log(JSON.stringify({ drivePdfFiles: inventory.length, total, driveFilesNotUsed: extra.length, byCourt, examples }, null, 2));
