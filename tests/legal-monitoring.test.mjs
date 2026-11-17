import test from 'node:test';
import assert from 'node:assert/strict';
import { dueReports,makeObservation,mayAutoPublish,renderReport } from '../src/legal-monitoring.mjs';

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

test('holds legal text updates and reservations from automatic publication',()=>{
  const law=makeObservation({...base,kind:'legislation'}).record;
  const reserved=makeObservation({...base,scientificReservation:true}).record;
  assert.equal(law.state,'held');
  assert.equal(mayAutoPublish(law),false);
  assert.equal(reserved.state,'held');
  assert.equal(mayAutoPublish(reserved),false);
});

test('schedules reports at the required Morocco wall-clock times',()=>{
  assert.deepEqual(dueReports(new Date('2026-11-17T07:00:00Z')).map(x=>x.type),['daily']);
  assert.deepEqual(dueReports(new Date('2026-11-21T08:00:00Z')).map(x=>x.type),['daily','weekly']);
  assert.deepEqual(dueReports(new Date('2026-11-23T08:00:00Z')).map(x=>x.type),['daily','justice']);
  assert.deepEqual(dueReports(new Date('2026-11-17T06:59:00Z')),[]);
  assert.deepEqual(dueReports(new Date('2026-11-17T07:01:00Z')).map(x=>x.type),['daily']);
});

test('report output identifies empty verified-source periods',()=>{
  const report=renderReport('daily',[],{localDate:'2026-11-17'});
  assert.match(report,/المغرب/);
  assert.match(report,/فرنسا/);
  assert.match(report,/لا توجد مستجدات رسمية متحققة/);
  assert.match(report,/لا يمثل غياب سجل دليلاً/);
});
