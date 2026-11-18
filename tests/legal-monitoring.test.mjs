import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORTS,dueReports,makeObservation,mayAutoPublish,lawStagesComplete,renderReport,mergeLegislativeObservation,publicationRecord,publicationCategory,effectiveToday,PUBLICATION_DELAY_MS,recentUpdates,tickerItems,isTickerItem } from '../src/legal-monitoring.mjs';

const official={url:'https://example.gov.ma/law/123',label:'الجريدة الرسمية',official:true,verified:true};
const base={country:'ma',kind:'case_law',title:'قرار تجريبي صادر عن المحكمة',summary:'ملخص موثق يتجاوز أربعين حرفاً مع بيانات القرار الأساسية والقاعدة القضائية.',eventDate:'2026-11-16',source:official,court:'محكمة الاستئناف',complete:true};

test('rejects missing or non-HTTPS or unverified source metadata',()=>{
  assert.ok(makeObservation({...base,source:{...official,verified:false}}).error);
  assert.ok(makeObservation({...base,source:{...official,url:'http://example.gov.ma'}}).error);
  assert.ok(makeObservation({...base,summary:'قصير'}).error);
});

test('creates stable identifiers for duplicate official observations',()=>{
  const a=makeObservation(base).record,b=makeObservation(base).record;
  assert.equal(a.id,b.id);
  assert.equal(a.state,'ready');
  assert.equal(mayAutoPublish(a),true);
});

test('holds Moroccan Court of Cassation decisions for the director',()=>{
  const item=makeObservation({...base,court:'محكمة النقض'}).record;
  assert.equal(item.state,'held');
  assert.equal(item.readyForAutomaticPublication,false);
  assert.match(item.holdReason,/اعتماد المدير/);
  assert.equal(mayAutoPublish(item),false);
});

test('legal text updates wait 24 hours before automatic publication; reservations hold them',()=>{
  const law=makeObservation({...base,kind:'legislation'}).record;
  const reserved=makeObservation({...base,scientificReservation:true}).record;
  assert.equal(law.state,'ready');
  assert.equal(mayAutoPublish(law),false,'laws need manager approval');
  assert.equal(lawStagesComplete({...law,currentStage:'project'}),false);
  assert.equal(lawStagesComplete({...law,currentStage:'published'}),true);
  assert.equal(lawStagesComplete({kind:'case_law'}),true);
  assert.equal(publicationCategory({country:'ma',kind:'case_law',court:'محكمة النقض'}),'إضافات النقض');
  assert.equal(publicationCategory({country:'ma',kind:'legislation',publishCategory:'قانون الأسرة'}),'قانون الأسرة');
  assert.equal(law.autoPublishAt.getTime()-law.receivedAt.getTime(),PUBLICATION_DELAY_MS);
  assert.equal(reserved.state,'held');
  assert.equal(reserved.autoPublishAt,null);
  assert.equal(mayAutoPublish(reserved),false);
});

test('Constitutional Court decisions and French items are routed to their own headings',()=>{
  assert.equal(publicationCategory({country:'ma',kind:'case_law',court:'المحكمة الدستورية'}),'القضاء الدستوري');
  assert.equal(publicationCategory({country:'fr',kind:'case_law',court:'Conseil constitutionnel'}),'المجلس الدستوري الفرنسي');
  assert.equal(publicationCategory({country:'fr',kind:'case_law',court:'Cour de cassation'}),'محكمة النقض الفرنسية');
  assert.equal(publicationCategory({country:'fr',kind:'legislation'}),'مستجدات فرنسية');
  assert.equal(publicationCategory({country:'ma',kind:'research'}),'مستجدات');
});

test('publication record carries stage, effective date, source and original',()=>{
  const item=makeObservation({...base,kind:'legislation',currentStage:'published',effectiveDate:'2026-12-01',original:{driveId:'abc',name:'x.pdf'}}).record;
  const rec=publicationRecord(item);
  assert.equal(rec.status,'published');
  assert.match(rec.text,/نُشر في الجريدة الرسمية/);
  assert.match(rec.text,/تاريخ النفاذ: 2026-12-01/);
  assert.equal(rec.originalFiles[0].driveId,'abc');
  assert.equal(effectiveToday([{...item,state:'published'}],'2026-12-01').length,1);
  assert.equal(effectiveToday([{...item,state:'published'}],'2026-12-02').length,0);
});

test('the legislative card advances from a bill to publication without duplication',()=>{
  const project=makeObservation({...base,kind:'bill',officialNumber:'60.26',reference:'قانون المالية 2027',currentStage:'approved'}).record;
  const published=makeObservation({...base,kind:'legislation',officialNumber:'60.26',reference:'قانون المالية 2027',eventDate:'2026-12-05',currentStage:'published'}).record;
  assert.equal(project.id,published.id);
  const merged=mergeLegislativeObservation(project,published);
  assert.equal(merged.currentStage,'published');
  assert.equal(merged.kind,'legislation');
  assert.equal(merged.history.length,2);
  assert.equal(mergeLegislativeObservation(merged,project).currentStage,'published');
});

test('schedules reports only for Monday 07:00, Wednesday 07:00 and the Saturday library update',()=>{
  assert.deepEqual(dueReports(new Date('2026-11-23T07:00:00Z')).map(x=>x.type),['monday']);
  assert.deepEqual(dueReports(new Date('2026-11-18T07:00:00Z')).map(x=>x.type),['wednesday']);
  assert.deepEqual(dueReports(new Date('2026-11-21T08:00:00Z')).map(x=>x.type),['saturday']);
  assert.deepEqual(dueReports(new Date('2026-11-17T09:00:00Z')),[]);
  assert.deepEqual(dueReports(new Date('2026-11-23T06:59:00Z')),[]);
  assert.equal(REPORTS.saturday.publishesLibrary,true);
});

test('report output identifies empty verified-source periods',()=>{
  const report=renderReport('monday',[],{localDate:'2026-11-17'});
  assert.match(report,/المغرب/);
  assert.match(report,/فرنسا/);
  assert.match(report,/لا توجد مستجدات رسمية متحققة/);
  assert.match(report,/لا يمثل غياب سجل دليلاً/);
});

test('recent updates keep published items for at most a week',()=>{
  const now=new Date('2026-11-20T10:00:00Z');
  const mk=(id,days)=>({id,title:id,country:'fr',kind:'case_law',state:'published',publishedAt:new Date(now.getTime()-days*86400000),eventDate:'2026-11-10'});
  assert.deepEqual(recentUpdates([mk('a',1),mk('b',8),{...mk('c',1),state:'held'}],now).map(x=>x.id),['a']);
  assert.deepEqual(recentUpdates([],now),[]);
});

test('شريط الأخبار: مشاريع القوانين والرقمنة القضائية فيه وحدها، وتُستثنى من المستجدات', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const mk = (id, kind, extra = {}) => ({ id, kind, title: id, state: 'published', publishedAt: '2026-11-17T10:00:00Z', source: { url: 'https://www.sgg.gov.ma/x' }, ...extra });
  assert.equal(isTickerItem({ kind: 'bill' }), true);
  assert.equal(isTickerItem({ kind: 'case_law' }), false);
  assert.deepEqual(tickerItems([mk('a', 'bill'), mk('b', 'case_law'), mk('c', 'justice_digital'), mk('d', 'bill', { state: 'held' }), mk('e', 'bill', { source: { url: 'javascript:alert(1)' } }), mk('f', 'bill', { publishedAt: '2026-10-01T00:00:00Z' })], now).map(x => x.id).sort(), ['a', 'c']);
  assert.deepEqual(recentUpdates([mk('a', 'bill'), mk('b', 'case_law')], now).map(x => x.id), ['b']);
});
