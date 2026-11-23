import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { untar, newArchives, jadeCandidates, constitCandidates, jorfCandidates, ccMaIds, ccMaDecision, candidateRecord, alreadyKnown, runLegalFeed } from '../src/legal-feed.mjs';
import { auditReport } from '../src/card-audit.mjs';

const now = new Date('2026-11-23T10:00:00Z');
const file = (name, xml) => ({ name, data: Buffer.from(xml) });

function tar(entries) {
  const blocks = [];
  for (const { name, data } of entries) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

const jadeA = file('x/jade/global/juri/CETA/TEXT/CETATEXT000000001.xml', "<ID>CETATEXT000000001</ID><TITRE>Conseil d'État, 5ème chambres réunies, 18/11/2026, 500001, Publié au recueil Lebon</TITRE><DATE_DEC>2026-11-18</DATE_DEC><JURIDICTION>Conseil d'Etat</JURIDICTION><NUMERO>500001</NUMERO><PUBLI_RECUEIL>A</PUBLI_RECUEIL>");
const jadeB = file('x/jade/global/juri/CETA/TEXT/CETATEXT000000002.xml', "<ID>CETATEXT000000002</ID><TITRE>CE B</TITRE><DATE_DEC>2026-11-18</DATE_DEC><JURIDICTION>Conseil d'Etat</JURIDICTION><NUMERO>500002</NUMERO><PUBLI_RECUEIL>B</PUBLI_RECUEIL>");
const caa = file('x/jade/global/juri/CETA/TEXT/CETATEXT000000003.xml', '<ID>CETATEXT000000003</ID><TITRE>CAA</TITRE><DATE_DEC>2026-11-18</DATE_DEC><JURIDICTION>CAA de NANTES</JURIDICTION><NUMERO>26NT1</NUMERO><PUBLI_RECUEIL>A</PUBLI_RECUEIL>');

test('مجلس الدولة: قرارات المجلس المنشورة في المجموعة (A) وحدها', () => {
  const c = jadeCandidates([jadeA, jadeB, caa], now);
  assert.equal(c.length, 1);
  assert.equal(c[0].caseNumber, '500001');
  assert.match(c[0].source.url, /legifrance\.gouv\.fr\/ceta\/id\/CETATEXT000000001$/);
});

test('المجلس الدستوري: QPC وDC لا الانتخابية', () => {
  const qpc = file('c/CONSTEXT1.xml', '<ID>CONSTEXT1</ID><NATURE>QPC</NATURE><TITRE>Société X</TITRE><DATE_DEC>2026-11-20</DATE_DEC><NUMERO>2026-1234</NUMERO><URL_CC>https://www.conseil-constitutionnel.fr/decision/2026/20261234QPC.htm</URL_CC>');
  const an = file('c/CONSTEXT2.xml', '<ID>CONSTEXT2</ID><NATURE>AN</NATURE><TITRE>Élection</TITRE><DATE_DEC>2026-11-20</DATE_DEC><NUMERO>2026-6000</NUMERO>');
  const c = constitCandidates([qpc, an], now);
  assert.deepEqual(c.map(x => x.officialNumber), ['2026-1234 QPC']);
});

test('الجريدة الرسمية: القوانين والأوامر والمراسيم المعدِّلة لمدونة، لا التعيينات ولا القديم', () => {
  const struct = (id, num) => file(`j/texte/struct/JORF/TEXT/00/${id}.xml`, `<ID_ELI>https://www.legifrance.gouv.fr/eli/loi/2026/11/21/X/jo/texte</ID_ELI><NUM>${num}</NUM>`);
  const version = (id, nature, title, date) => file(`j/texte/version/JORF/TEXT/00/${id}.xml`, `<NATURE>${nature}</NATURE><NOR>NOR${id}</NOR><DATE_PUBLI>${date}</DATE_PUBLI><TITREFULL>${title}</TITREFULL>`);
  const files = [
    struct('JORFTEXT1', '2026-1072'), version('JORFTEXT1', 'LOI', 'LOI n° 2026-1072 du 21 novembre 2026', '2026-11-22'),
    version('JORFTEXT2', 'DECRET', 'Décret portant nomination du préfet', '2026-11-22'),
    struct('JORFTEXT3', '2026-1080'), version('JORFTEXT3', 'DECRET', 'Décret modifiant le code de procédure civile', '2026-11-22'),
    version('JORFTEXT4', 'ARRETE', 'Arrêté relatif au code de la route', '2026-11-22'),
    version('JORFTEXT5', 'LOI', 'LOI ancienne', '2026-09-01'),
  ];
  const c = jorfCandidates(files, now);
  assert.deepEqual(c.map(x => x.officialNumber).sort(), ['2026-1072', '2026-1080']);
  assert.ok(c.every(x => x.kind === 'legislation' && x.currentStage === 'published'));
});

test('المحكمة الدستورية المغربية: الرقم والتاريخ من صفحة القرار (ولو بكيانات HTML)', () => {
  assert.deepEqual(ccMaIds('<a href="./Decision?id=2158&Page=Decision"></a><a href="./Decision?id=2159&amp;Page=Decision"></a>'), [2158, 2159]);
  const enc = s => [...s].map(ch => `&#x${ch.codePointAt(0).toString(16)};`).join('');
  const d = ccMaDecision(`<div>${enc('قرار رقم :')}</div><div>295/26</div><div>${enc('تاريخ صدور القرار :')}</div><div>2026/11/11</div>`, 2159);
  assert.equal(d.caseNumber, '295/26');
  assert.equal(d.eventDate, '2026-11-11');
});

test('المرشح محجوز، بلا محتوى، لا يُنشر ولا يدخل تدقيق البطاقات', () => {
  const r = candidateRecord(jadeCandidates([jadeA], now)[0], now);
  assert.equal(r.state, 'held');
  assert.equal(r.candidate, true);
  assert.equal(r.readyForAutomaticPublication, false);
  assert.equal(r.summary, '');
  assert.equal(auditReport([r]).checked, 0);
});

test('لا مرشح لما سجّله الجامع أو حذفه المدير برقمه', () => {
  const r = candidateRecord(jadeCandidates([jadeA], now)[0], now);
  assert.ok(alreadyKnown(r, [{ _id: 'other', country: 'fr', kind: 'case_law', caseNumber: '500001', state: 'dismissed' }]));
  assert.ok(!alreadyKnown(r, [{ _id: 'other', country: 'fr', kind: 'case_law', caseNumber: '499999', state: 'published' }]));
});

test('أرشيفات DILA الجديدة فقط', () => {
  const html = '<a href="JADE_20261110-100000.tar.gz"></a><a href="JADE_20261120-100000.tar.gz"></a><a href="JADE_20261121-100000.tar.gz"></a>';
  assert.deepEqual(newArchives(html, 'JADE', '', now), ['20261120-100000', '20261121-100000']);
  assert.deepEqual(newArchives(html, 'JADE', '20261120-100000', now), ['20261121-100000']);
});

test('التشغيل اليومي: يضيف المرشحين مرة واحدة، ولا يعيد التشغيل في اليوم نفسه، ويحفظ ما عولج', async () => {
  const docs = new Map(), settings = new Map();
  const store = {
    settings: { findOne: async ({ _id }) => settings.get(_id) || null, updateOne: async ({ _id }, { $set }) => { settings.set(_id, { _id, ...(settings.get(_id) || {}), ...$set }); } },
    legalMonitorItems: {
      find: () => ({ toArray: async () => [...docs.values()] }),
      updateOne: async ({ _id }, { $setOnInsert }) => { if (!docs.has(_id)) docs.set(_id, $setOnInsert); },
      deleteMany: async () => ({ deletedCount: 0 }),
    },
  };
  const archive = gzipSync(tar([jadeA, jadeB]));
  const fetchImpl = async url => {
    const ok = body => ({ ok: true, status: 200, text: async () => body, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.length) });
    if (url.endsWith('/JADE/')) return ok('<a href="JADE_20261121-100000.tar.gz"></a>');
    if (url.endsWith('.tar.gz')) return ok('');
    if (url.endsWith('/JORF/') || url.endsWith('/CONSTIT/')) return ok('');
    if (url === 'https://www.cour-constitutionnelle.ma/') return ok('');
    return { ok: false, status: 404 };
  };
  const first = await runLegalFeed(store, { now, fetchImpl });
  assert.equal(first.added, 1);
  assert.deepEqual(first.errors, []);
  assert.equal(settings.get('legal-feed').archives.JADE, '20261121-100000');
  assert.equal((await runLegalFeed(store, { now, fetchImpl })).skipped, true);
  const next = await runLegalFeed(store, { now: new Date('2026-11-24T10:00:00Z'), fetchImpl });
  assert.equal(next.added, 0, 'الأرشيف نفسه لا يُعالج مرتين والمرشح لا يتكرر');
});

test('tar: يقرأ أسماء الملفات ومحتواها', () => {
  const out = [...untar(tar([file('a/b.xml', '<X>1</X>')]))];
  assert.equal(out[0].name, 'a/b.xml');
  assert.equal(out[0].data.toString(), '<X>1</X>');
});
