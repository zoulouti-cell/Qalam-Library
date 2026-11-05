import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { brotliDecompressSync } from 'node:zlib';
import { normalizeSearch,tokens,meaningfulTokens,STOP,relatedQueries,snippet,citationOf,isAnswerReady,kindOf } from './text.mjs';
import { orderedCategories, catalogCategory } from './catalog.mjs';
import { instrumentOrderSql, legislationHeading } from './legislation.mjs';
import { reflowReading } from './reading.mjs';
import { driveSourceForDocument } from './drive.mjs';
import { officialSourceForDocument } from './official-sources.mjs';

function shortJudicialTitle(title){let out='';for(let i=0;i<title.length;i++){const c=title[i];if((c==='،'||c===',')||((c==='.'||c==='。')&&!(/\d/.test(title[i-1]||'')&&/\d/.test(title[i+1]||''))))break;out+=c;}return out.trim()||title;}
function displayTitle(row){if(row.type==='national'&&/بالمصادقة\s+على\s+مجموعة\s+القانون\s+الجنائي/.test(row.title))return (row.law_number?row.law_number+' — ':'')+'مجموعة القانون الجنائي';return row.title;}
const TOPIC_TERMS=new Map([['المادة المدنية',['مدني','مدنية','المدنية','الالتزامات','العقود','التحفيظ','العقاري']],['المادة الجنائية',['جنائي','جنائية','الجريمة','العقوبة','الاعتقال']],['المادة الاجتماعية',['الشغل','شغل','التشغيل','اجتماعي','اجتماعية','الأجير','الأجراء']],['المادة الأسرية',['الأسرة','أسري','النفقة','الطلاق','الحضانة','الزواج']],['المادة التجارية',['التجارة','تجاري','تجارية','الشركات','المقاولة','التاجر']],['المادة الإدارية',['إداري','إدارية','الإدارة','الإداري']],['المادة العقارية',['عقار','العقار','التحفيظ','الملكية','العقاري']],['المادة المالية',['مالي','مالية','الضرائب','الضريبة','الجبايات']],['المادة الدستورية',['دستوري','دستورية','الدستور','الدستورية']]].map(([key,terms])=>[normalizeSearch(key),terms]));
const REFERENCE_SEARCH_TERMS=new Map([
  ['دستور المملكة المغربية لسنة 2011',['دستور المملكة المغربية لسنة 2011','دستور المملكة','الدستور المغربي','دستور المغرب','الدستور']],
  ['المسطرة المدنية',['المسطرة المدنية','قانون المسطرة المدنية','التنفيذ المدني','الحجز التنفيذي']],
  ['المسطرة الجنائية',['قانون المسطرة الجنائية','المسطرة الجنائية','الاعتقال الاحتياطي','الشرطة القضائية']],
  ['الالتزامات والعقود',['قانون الالتزامات والعقود','الالتزامات والعقود','الالتزامات','العقود','المسؤولية المدنية']],
  ['مجموعة القانون الجنائي',['مجموعة القانون الجنائي','القانون الجنائي','القانون الجنائى','القانون الجنائي المغربي','الجريمة','العقوبة','جنائي']],
  ['مدونة التجارة',['مدونة التجارة','قانون التجارة','القانون التجاري','التجارة','العقود التجارية','الشركات التجارية','التاجر','الأصل التجاري']],
  ['مدونة الأسرة',['مدونة الأسرة','قانون الأسرة','الأحوال الشخصية','النفقة','الطلاق','الحضانة','الزواج']],
  ['مدونة الشغل',['مدونة الشغل','قانون الشغل','الشغل','الأجير','الأجراء','عقد الشغل','عقد العمل']],
  ['مدونة السير',['مدونة السير','قانون السير','حوادث السير']],
  ['مدونة الحقوق العينية',['مدونة الحقوق العينية','الحقوق العينية','الحق العيني']],
  ['التحفيظ العقاري',['التحفيظ العقاري','قانون التحفيظ العقاري','الرسم العقاري']],
  ['03.01',['تعليل القرارات الإدارية','تعليل القرار الإداري','03.01']],
  ['55.19',['تبسيط المساطر الإدارية','المساطر والإجراءات الإدارية','55.19']],
  ['54.19',['ميثاق المرافق العمومية','54.19']],
  ['54.05',['التدبير المفوض للمرافق العامة','التدبير المفوض','54.05']],
].map(([title,terms])=>[title,terms.map(normalizeSearch)]));
const CORE_REFERENCE_ORDER=`CASE WHEN d.type='national' AND d.title='دستور المملكة المغربية لسنة 2011' THEN 0 WHEN d.type='national' AND d.title='الالتزامات والعقود' THEN 1 WHEN d.type='national' AND d.law_number='58.25' THEN 2 WHEN d.type='national' AND d.title LIKE 'ظهير شريف بالمصادقة على مجموعة القانون الجنائي%' THEN 3 WHEN d.type='national' AND d.law_number='22.01' THEN 4 WHEN d.type='national' AND d.law_number='15.95' THEN 5 WHEN d.type='national' AND d.law_number='65.99' THEN 6 WHEN d.type='national' AND d.law_number='39.08' THEN 7 WHEN d.type='national' AND d.law_number='70.03' THEN 8 ELSE 99 END`;
function topicMatch(topic){const normalized=normalizeSearch(topic||'');if(!normalized)return '';const terms=TOPIC_TERMS.get(normalized)||normalized.split(/\s+/).filter(t=>t.length>2&&!['المادة','مادة','القانون','قانون','مدونة','مجموعة','المغربي','المغربية','بشأن'].includes(t));if(!terms.length)return '"__qalam_topic_without_terms__"';const variants=new Set();for(const raw of terms){const term=normalizeSearch(raw);variants.add('"'+term+'"*');if(!term.startsWith('ال'))variants.add('"ال'+term+'"*');}return '('+[...variants].join(' OR ')+')';}

export class Library {
  constructor(file) {
    this.file=file;this.db=new DatabaseSync(file,{readOnly:true});
    this.db.exec('PRAGMA query_only=ON;PRAGMA cache_size=-12000;');
    this.meta=Object.fromEntries(this.db.prepare('SELECT key,value FROM metadata').all().map(r=>[r.key,JSON.parse(r.value)]));this.lawTitles=new Map(this.db.prepare('SELECT id,original_title,display_title,number,basis FROM law_titles').all().map(r=>[r.id,r]));
    this.cache=new Map();this.searchCache=new Map();this.readingCache=new Map();this.managedDocs=new Map();this.sourceUrlCache=null;
  }
  setManagedContent(records=[]){this.managedDocs=new Map(records.filter(d=>d&&d.status==='published'&&d.documentId).map(d=>[d.documentId,d]));this.searchCache.clear();}
  refresh(){if(Date.now()<(this.nextRefresh||0))return;this.nextRefresh=Date.now()+1000;const generation=JSON.parse(this.db.prepare("SELECT value FROM metadata WHERE key='generation'").get()?.value||'0');if(generation!==(this.meta.generation||0)){this.meta=Object.fromEntries(this.db.prepare('SELECT key,value FROM metadata').all().map(r=>[r.key,JSON.parse(r.value)]));this.cache.clear();this.searchCache.clear();this.readingCache.clear();}}
  stats(){this.refresh();const {originalCategories,...meta}=this.meta;const added=[...this.managedDocs.values()].filter(d=>!this.db.prepare('SELECT 1 FROM documents WHERE id=?').get(d.documentId));return {...meta,documents:meta.documents+added.length,extractedText:meta.extractedText+added.filter(d=>d.textKind==='extracted_text').length,dbBytes:fs.statSync(this.file).size,categories:this.db.prepare('SELECT count(DISTINCT category) n FROM documents').get().n+added.filter(d=>!this.db.prepare('SELECT 1 FROM documents WHERE category=?').get(d.category)).length,quality:{needsReview:meta.needsReview,automatedReview:meta.automatedReview}};}
  categories(){const grouped=new Map();for(const d of this.db.prepare('SELECT rowid,title,type,category,kind FROM documents ORDER BY rowid').all()){const name=catalogCategory(d),row=grouped.get(name)||{name,count:0,legislationCount:0,jurisprudenceCount:0,studiesCount:0};row.count++;if(d.type==='national'&&d.kind!=='study')row.legislationCount++;if(d.type==='juriscassation'||(d.type==='judicial'&&!/دراسات|مجلة/.test(name)))row.jurisprudenceCount++;if(d.type==='judicial'&&/دراسات|مجلة/.test(name))row.studiesCount++;grouped.set(name,row);}const result=orderedCategories([...grouped.values()],this.meta.originalCategories);for(const d of this.managedDocs.values()){if(this.db.prepare('SELECT 1 FROM documents WHERE id=?').get(d.documentId))continue;let row=result.find(x=>x.name===d.category);if(!row){row={name:d.category,count:0,legislationCount:0,jurisprudenceCount:0,studiesCount:0};result.push(row);}row.count++;if(d.kind==='study')row.studiesCount++;else if(d.type==='national')row.legislationCount++;else row.jurisprudenceCount++;}return result;}
  text(row){if(this.cache.has(row.id)){const text=this.cache.get(row.id);this.cache.delete(row.id);this.cache.set(row.id,text);return text;}const text=brotliDecompressSync(Buffer.from(row.body)).toString('utf8');this.cache.set(row.id,text);if(this.cache.size>24)this.cache.delete(this.cache.keys().next().value);return text;}
  sourceUrls(){if(!this.sourceUrlCache){this.sourceUrlCache=new Map();for(const row of this.db.prepare('SELECT id,assessment FROM reading_audit').all()){try{const url=JSON.parse(row.assessment||'{}').officialSourceUrl;if(typeof url==='string'&&/^https:\/\//i.test(url))this.sourceUrlCache.set(row.id,url);}catch{}}}return this.sourceUrlCache;}
  public(row,q='') {const kind=kindOf(row);let baseTitle=kind==='decision'||kind==='jurisprudence'?shortJudicialTitle(row.title):row.title,lawNumber=row.law_number;const lawMeta=row.type==='national'?this.lawTitles.get(row.id):null;if(row.type==='national'&&(kind==='law'||row.kind==='law')){const edited=lawMeta&&row.title!==lawMeta.display_title,original=edited?row.title:(lawMeta?.original_title||row.title);const heading=legislationHeading({...row,title:original},this.text(row),{numberOverride:edited?(row.law_number||undefined):(lawMeta?.number||undefined),overrideBasis:lawMeta?.basis});baseTitle=heading.title;lawNumber=heading.number||lawNumber;}else baseTitle=displayTitle(row);const driveSource=driveSourceForDocument(row.id),sourceUrl=this.sourceUrls().get(row.id)||'',officialUrl=officialSourceForDocument({type:row.type,kind,category:catalogCategory(row),subcategory:row.subcategory,title:baseTitle,sourceUrl});return {id:row.id,title:baseTitle,originalTitle:baseTitle===row.title?undefined:(lawMeta?.original_title||row.title),type:row.type,category:catalogCategory(row),subcategory:row.subcategory,date:row.date,kind:kind==='law'||row.kind==='law'?'law':kind,textKind:row.text_kind,reviewStatus:row.review_status,issues:JSON.parse(row.issues||'[]'),snippet:snippet(this.text(row),q),score:row._rank? -row._rank:0,lawNumber,decisionNumber:row.type==='juriscassation'?row.decision_number:'',caseNumber:row.type==='juriscassation'?row.case_number:'',abrogated:!!row.abrogated,chars:row.chars,sourceLabel:row.source_label,sourceUrl,officialUrl,driveSourceName:driveSource?.name||'',driveSourcePath:driveSource?.path||'',judicialIndex:!!driveSource?.judicialIndex,driveSourceStatus:driveSource?.status||(driveSource?'mapped':'unmapped')};}
  document(id){const managed=this.managedDocs.get(id);if(managed){const base=this.baseDocument(id),text=String(managed.text||base?.text||''),type=managed.type||base?.type||'national',category=managed.category||base?.category||'غير مصنف',title=managed.title||base?.title||'وثيقة قانونية',sourceUrl=managed.sourceUrl||base?.sourceUrl||'',reading=reflowReading(text,{});return {...(base||{}),id,title,type,category,subcategory:managed.subcategory||base?.subcategory||'',date:managed.date||base?.date||'',kind:managed.kind||base?.kind||'law',textKind:managed.textKind||'extracted_text',reviewStatus:'human_verified',issues:[],chars:text.length,snippet:snippet(text,''),text,headings:reading.headings||[],citation:managed.citation||base?.citation||'',sourceUrl,officialUrl:officialSourceForDocument({title,category,type,sourceUrl,officialUrl:managed.officialUrl}),sourceLabel:managed.sourceLabel||base?.sourceLabel||'مادة معتمدة في إدارة المكتبة',abrogated:!!managed.abrogated};}return this.baseDocument(id);}  baseDocument(id){this.refresh();const row=this.db.prepare('SELECT * FROM documents WHERE id=?').get(id);if(!row)return null;const rawAssessment=this.db.prepare('SELECT assessment FROM reading_audit WHERE id=?').get(id)?.assessment;const assessment=rawAssessment?JSON.parse(rawAssessment):null;let reading=this.readingCache.get(id);if(!reading){reading=reflowReading(this.text(row),assessment||{});this.readingCache.set(id,reading);if(this.readingCache.size>12)this.readingCache.delete(this.readingCache.keys().next().value);}const titleInfo=row.type==='national'?this.db.prepare('SELECT original_title FROM law_titles WHERE id=?').get(id):null;const publicDoc=this.public(row);return {...publicDoc,...reading,chars:reading.text.length,originalTitle:titleInfo?.original_title||row.title,citation:citationOf({...row,title:publicDoc.title}),sourceTextSha256:row.sha256,readingAssessment:assessment,sourceUrl:assessment?.officialSourceUrl||''};}
  fts(query,{relaxed=false,prefix=false,titleOnly=false}={}) {
    const phrase=String(query).trim().match(/^["«“](.+)["»”]$/);
    if(phrase&&!prefix){const phraseTokens=tokens(phrase[1]).slice(0,20);return phraseTokens.length?'"'+phraseTokens.join(' ')+'"':'';}
    const words=tokens(query).filter(w=>w.length>1||/^\d+$/.test(w)).slice(0,12);
    if(!words.length)return '';
    const quoted=words.map((w,i)=>'"'+w.replaceAll('"','""')+'"'+(prefix&&i===words.length-1?'*':''));
    const whole=quoted.join(relaxed?' OR ':' AND ');return titleOnly?'title : ('+whole+')':whole;
  }
  filters(params){const clauses=[],values=[];
    if(params.scope==='legislation'){clauses.push("d.type='national' AND d.kind<>'study'");}else if(params.scope==='jurisprudence'){clauses.push("(d.type='juriscassation' OR (d.type='judicial' AND d.category NOT LIKE '%دراسات%' AND d.category NOT LIKE '%مجلة%'))");}else if(params.scope==='studies'){clauses.push("(d.type='judicial' AND (d.category LIKE '%دراسات%' OR d.category LIKE '%مجلة%'))");}
    if(['national','judicial','juriscassation'].includes(params.type)){clauses.push('d.type=?');values.push(params.type);}
    if(params.category==='المادة البيئية'){clauses.push("(d.category=? OR d.title LIKE '%الأجزاء التابعة%الملك العمومي%')");values.push(params.category);}
    else if(params.category==='مادة الفلاحة'){clauses.push("(d.category=? OR (d.category='قوانين وتشريعات وطنية' AND d.title NOT LIKE '%الأجزاء التابعة%'))");values.push(params.category);}
    else if(params.category){clauses.push('d.category=?');values.push(String(params.category).slice(0,200));}    const kinds={text:'extracted_text',summary:'source_summary',catalog:'image_only'};
    if(kinds[params.quality]){clauses.push('d.text_kind=?');values.push(kinds[params.quality]);}
    for(const [key,operator] of [['from','>='],['to','<=']])if(/^\d{4}(?:-\d{2}-\d{2})?$/.test(params[key]||'')){clauses.push('d.date '+operator+' ?');values.push(params[key].length===4?params[key]+(key==='from'?'-01-01':'-12-31'):params[key]);}
    return {clauses,values};
  }
  search(params={}){
    this.refresh();
    const started=performance.now(),q=String(params.q||'').trim().slice(0,300),page=Math.max(1,Math.min(100000,Number(params.page)||1)),limit=Math.max(1,Math.min(50,Number(params.limit)||20));
    const key=JSON.stringify({...params,q,page,limit});if(this.searchCache.has(key))return {...this.searchCache.get(key),elapsedMs:Math.round(performance.now()-started),cached:true};
    const {clauses,values}=this.filters(params);const topic=topicMatch(params.topic),queryMatch=this.fts(q);let relaxed=false,total=0;
    const normalizedQuery=normalizeSearch(q);
    const reference=[...REFERENCE_SEARCH_TERMS].flatMap(([title,terms])=>terms.filter(term=>normalizedQuery.includes(term)).map(term=>({title,length:term.length}))).sort((a,b)=>b.length-a.length)[0]?.title||'';
    const referenceMatch=reference?this.fts(reference,{titleOnly:true}):'';
    const effectiveQueryMatch=[queryMatch,referenceMatch].filter(Boolean).map(x=>'('+x+')').join(' OR ');
    let match=[effectiveQueryMatch,topic].filter(Boolean).map(x=>'('+x+')').join(' AND ');
    const count=()=>this.db.prepare('SELECT count(*) n FROM '+(match?'search JOIN documents d ON d.rowid=search.rowid':'documents d')+' WHERE '+[...(match?['search MATCH ?']:[]),...clauses,'1=1'].join(' AND ')).get(...(match?[match]:[]),...values).n;
    total=count();
    if(!total&&queryMatch&&tokens(q).length>1){const relaxedMatch=[this.fts(q,{relaxed:true}),referenceMatch].filter(Boolean).map(x=>'('+x+')').join(' OR ');match=[relaxedMatch,topic].filter(Boolean).map(x=>'('+x+')').join(' AND ');relaxed=true;total=count();}
    const where=[...(match?['search MATCH ?']:[]),...clauses,'1=1'].join(' AND ');
    const number=/^\d+(?:[.\/-]\d+)+$/.test(normalizeSearch(q))?normalizeSearch(q).replace(/[\/-]/g,'.'):'';
    const ranked=match?'SELECT d.*,bm25(search,8.0,1.0) _rank FROM search JOIN documents d ON d.rowid=search.rowid':'SELECT d.*,0 _rank FROM documents d LEFT JOIN catalog_order o ON o.doc_rowid=d.rowid';
    const generalUnfiltered=(params.scope==='all'||!params.scope)&&!params.category&&!params.topic&&(!params.type||params.type==='all');
    const order=(match?"CASE WHEN ?<>'' AND d.type='national' AND d.title_norm LIKE ? AND length(d.title)<140 THEN 0 ELSE 1 END,":'')+(generalUnfiltered?CORE_REFERENCE_ORDER+',':'')+(match?'d.abrogated ASC,':'')+instrumentOrderSql('d')+','+(match?"CASE WHEN replace(replace(d.law_number,'-','.'),'/','.')=? AND ?<>'' THEN 0 ELSE 1 END,CASE WHEN ?<>'' AND d.type='national' AND d.title_norm LIKE ? THEN 0 ELSE 1 END,CASE WHEN ?<>'' AND d.type='national' AND d.title_norm LIKE ? THEN length(d.title) ELSE 9999 END,bm25(search,8.0,1.0)*CASE WHEN d.text_kind='extracted_text' THEN 1.15 ELSE 1 END ASC,d.rowid":"COALESCE(o.position,2147483647),d.rowid");
    const rows=this.db.prepare(ranked+' WHERE '+where+' ORDER BY '+order+' LIMIT ? OFFSET ?').all(...(match?[match]:[]),...values,...(match?[reference,'%'+reference+'%',number,number,reference,'%'+reference+'%',reference,'%'+reference+'%']:[]),limit,(page-1)*limit);
    const baseResults=rows.map(row=>{const managed=this.managedDocs.get(row.id);if(!managed)return this.public(row,q);const doc=this.document(row.id);return {...doc,snippet:snippet(doc.text,q),score:row._rank?-row._rank:0};});
    const managedResults=[];const queryTerms=tokens(q),normQ=normalizeSearch(q);for(const d of this.managedDocs.values()){if(baseResults.some(r=>r.id===d.documentId))continue;if(params.type&&params.type!=='all'&&params.type!==d.type)continue;if(params.category&&params.category!==d.category)continue;if(params.scope==='legislation'&&d.type!=='national')continue;if(params.scope==='jurisprudence'&&!['judicial','juriscassation'].includes(d.type))continue;if(params.scope==='studies'&&d.kind!=='study')continue;if(params.quality==='text'&&d.textKind!=='extracted_text')continue;if(params.quality==='summary'&&d.textKind!=='source_summary')continue;if(params.quality==='catalog'&&d.textKind!=='image_only')continue;if(params.from&&String(d.date||'')<params.from)continue;if(params.to&&String(d.date||'')>params.to+'\uffff')continue;const doc=this.document(d.documentId),hay=normalizeSearch((doc.title||'')+' '+(doc.category||'')+' '+(doc.text||''));if(queryTerms.length&&!queryTerms.every(t=>hay.includes(t))&&!(normQ&&hay.includes(normQ)))continue;if(params.topic&&!normalizeSearch(doc.category+' '+doc.title+' '+doc.text).includes(normalizeSearch(params.topic).split(' ')[0]))continue;managedResults.push({...doc,snippet:snippet(doc.text,q),score:10});}
    const merged=[...baseResults,...managedResults],totalMerged=total+managedResults.length,offset=(page-1)*limit;
    const results=page===1?[...managedResults,...baseResults].slice(0,limit):baseResults;
    const result={query:q,total:totalMerged,page,limit,results,suggestions:relatedQueries(q,params.scope),relaxed,elapsedMs:Math.round(performance.now()-started)};
    this.searchCache.set(key,result);if(this.searchCache.size>100)this.searchCache.delete(this.searchCache.keys().next().value);return result;
  }
  suggest(q){q=String(q||'').trim().slice(0,160);if(!q)return {suggestions:[]};const match=this.fts(q,{prefix:true,titleOnly:true}),result=[];
    if(match)for(const d of this.db.prepare('SELECT d.id,d.title,d.type,d.category FROM search JOIN documents d ON d.rowid=search.rowid WHERE search MATCH ? ORDER BY '+instrumentOrderSql('d')+',bm25(search,10,0) LIMIT 6').all(match))result.push({text:['decision','jurisprudence'].includes(kindOf(d))?shortJudicialTitle(d.title):d.title,type:'title',id:d.id});
    const last=tokens(q).at(-1);if(last&&last.length>1)for(const r of this.db.prepare("SELECT term FROM terms WHERE term>=? AND term<? ORDER BY count DESC LIMIT 4").all(last,last+'\uffff'))if(!result.some(v=>v.text===r.term))result.push({text:r.term,type:'term'});
    if(!result.length&&last&&last.length>=4){const candidates=this.db.prepare('SELECT term FROM terms WHERE term>=? AND term<? ORDER BY count DESC LIMIT 80').all(last[0],last[0]+'\uffff');for(const {term}of candidates)if(distanceOne(last,term))result.push({text:term,type:'term'});}
    const prefix=normalizeSearch(q);for(const d of this.managedDocs.values()){const doc=this.document(d.documentId);if(doc?.title&&normalizeSearch(doc.title).startsWith(prefix)&&!result.some(x=>x.id===doc.id))result.unshift({text:doc.title,type:'title',id:doc.id});}
    for(const text of relatedQueries(q))result.push({text,type:'related'});return {suggestions:result.slice(0,10)};
  }
  retrieve(question,documentId){
    if(documentId){const d=this.document(documentId);if(!d?.text)return [];const p=bestPassage(d,question);return [{id:d.id,title:d.title,excerpt:p.text,label:p.label,textKind:d.textKind,reviewStatus:d.reviewStatus,answerReady:isAnswerReady({text_kind:d.textKind,issues:d.issues}),abrogated:d.abrogated,citation:d.citation,documentType:d.type,kind:d.kind,date:d.date,sourceUrl:d.sourceUrl||'',officialUrl:d.officialUrl||officialSourceForDocument(d)}];}
    let words=meaningfulTokens(question);
    words=words.map(term=>({term,df:this.db.prepare('SELECT doc FROM vocabulary WHERE term=?').get(term)?.doc||0})).filter(t=>t.df).sort((a,b)=>a.df-b.df).slice(0,7).map(t=>t.term);
    const candidate=this.search({q:words.join(' ')||question,quality:'text',limit:35});
    const fallback=candidate.results.length<5?this.search({q:words.join(' ')||question,limit:10}).results:[];
    const ids=[...(documentId?[documentId]:[]),...candidate.results.map(r=>r.id),...fallback.map(r=>r.id)];
    const sources=[];for(const id of [...new Set(ids)]){const d=this.document(id);if(!d||!d.text)continue;
      const ready=isAnswerReady({text_kind:d.textKind,issues:d.issues});
      const passage=bestPassage(d,question);
      sources.push({id:d.id,title:d.title,excerpt:passage.text,label:passage.label,textKind:d.textKind,reviewStatus:d.reviewStatus,answerReady:ready,abrogated:d.abrogated,citation:d.citation,documentType:d.type,kind:d.kind,date:d.date,sourceUrl:d.sourceUrl||'',officialUrl:d.officialUrl||officialSourceForDocument(d)});
      if(sources.filter(s=>s.answerReady&&!s.abrogated&&s.kind!=='study').length>=4)break;
    }
    const score=s=>(s.id===documentId?100:0)+(s.answerReady&&!s.abrogated?10:0)+(s.documentType==='national'?3:s.kind==='study'?0:2);
    return sources.sort((a,b)=>score(b)-score(a)).slice(0,5);
  }
  close(){this.db.close();}
}
function distanceOne(a,b){if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,d=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++d>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}return d+(i<a.length||j<b.length?1:0)<=1;}
function bestPassage(doc,question){
  const article=normalizeSearch(question).match(/(?:المادة|الفصل)\s*(\d+)/);
  if(article){const h=doc.headings.find(h=>h.number===article[1]&&['المادة','الفصل'].includes(h.marker));if(h)return {text:doc.text.slice(h.start,Math.min(h.end,h.start+1600)).trim(),label:h.label};}
  const normalized=normalizeSearch(doc.text),terms=meaningfulTokens(question);let at=0,best=-1;
  for(const term of terms){let pos=normalized.indexOf(term),seen=0;while(pos>=0&&seen++<12){const start=Math.max(0,pos-180),window=normalized.slice(start,start+1100);const score=terms.reduce((n,t)=>n+(window.includes(t)?1:0),0);if(score>best){best=score;at=start;}pos=normalized.indexOf(term,pos+term.length);}}
  const h=[...doc.headings].reverse().find(h=>h.start<=at);return {text:doc.text.slice(at,at+1200).trim(),label:h?.label||'مقتطف من النص المتاح'};
}
