'use strict';
/* تدقيق البطاقة الموحّدة: كل بطاقات المستجدات (إضافات النقض، القسم الفرنسي، مقترحات القوانين، المستجدات) مقابل القالب. */
(()=>{
  const tabs=document.querySelector('.admin-tabs');if(!tabs||document.getElementById('cardAuditPanel'))return;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});let j={};try{j=await r.json();}catch{}if(!r.ok)throw new Error(j.error||'تعذر إتمام الطلب.');return j;}
  const states={ready:'جاهزة',held:'محجوزة',published:'منشورة'};
  const tab=document.createElement('button');tab.type='button';tab.dataset.panel='cardAuditPanel';tab.innerHTML='<span class="tab-n">10</span>تدقيق البطاقات';tabs.append(tab);
  const panel=document.createElement('div');panel.id='cardAuditPanel';panel.className='tab-panel';panel.hidden=true;
  panel.innerHTML='<header class="topic-head"><div><h2>تدقيق البطاقة الموحّدة</h2><p>يفحص كل بطاقات المستجدات: العناوين الخمسة بترتيبها، العنوان العربي، المصدر بالعربية، الرابط الرسمي، صدق سطر «الأصل»، الملاحظات التقنية، والتكرار. «إصلاح تلقائي» يرتّب الأقسام ويحذف الملاحظات التقنية ويصحح سطر «الأصل» فقط، ولا يكتب أي محتوى.</p></div></header><section class="panel"><p><button type="button" id="auditRun">تحديث التقرير</button> <button type="button" id="auditFix">إصلاح تلقائي لما يُصلح</button></p><p id="auditMessage" class="muted" role="status"></p><div id="auditReport"></div></section>';
  (document.getElementById('trashPanel')||document.getElementById('legalMonitorPanel')||tabs).after(panel);
  const out=()=>document.getElementById('auditReport'),msg=t=>{document.getElementById('auditMessage').textContent=t||'';};
  async function load(){
    out().innerHTML='<p class="muted">جارٍ الفحص…</p>';
    try{const r=await api('/api/admin/card-audit');
      const cats=Object.entries(r.byCategory||{}).sort((a,b)=>b[1].faulty-a[1].faulty).map(([c,v])=>'<tr><td>'+esc(c)+'</td><td>'+v.total+'</td><td>'+v.faulty+'</td></tr>').join('');
      const cards=(r.cards||[]).map(c=>'<tr><td>'+esc(c.title)+'</td><td>'+esc(c.category)+'</td><td>'+esc(states[c.state]||c.state)+'</td><td>'+c.issues.map(i=>esc(i.label)+(i.fixable?' <small>(يُصلح تلقائياً)</small>':'')).join('<br>')+'</td></tr>').join('');
      const dups=(r.duplicates||[]).map(g=>'<li>'+g.map(x=>esc(x.title)+' <small>('+esc(states[x.state]||x.state)+')</small>').join(' ⇄ ')+'</li>').join('');
      out().innerHTML='<p><strong>'+r.checked+'</strong> بطاقة مفحوصة · <strong>'+r.faulty+'</strong> مخالفة · <strong>'+r.fixable+'</strong> قابلة للإصلاح التلقائي · <strong>'+(r.duplicates||[]).length+'</strong> مجموعة مكررة</p>'
        +'<h3>حسب الفرع</h3><table class="data-table"><thead><tr><th>الفرع</th><th>البطاقات</th><th>المخالفة</th></tr></thead><tbody>'+cats+'</tbody></table>'
        +(dups?'<h3>بطاقات مكررة (تُحذف المكررة من المكتبة بزر الحذف، وتبقى في سلة المحذوفات)</h3><ul>'+dups+'</ul>':'')
        +(cards?'<h3>البطاقات المخالفة</h3><table class="data-table"><thead><tr><th>العنوان</th><th>الفرع</th><th>الحالة</th><th>المخالفات</th></tr></thead><tbody>'+cards+'</tbody></table>':'<p>كل البطاقات مطابقة للقالب.</p>');
    }catch(error){out().innerHTML='<p class="muted">'+esc(error.message)+'</p>';}
  }
  tabs.addEventListener('click',e=>{if(e.target.closest('[data-panel]')?.dataset.panel==='cardAuditPanel'){msg('');load();}});
  panel.addEventListener('click',async e=>{
    if(e.target.id==='auditRun'){msg('');load();}
    if(e.target.id==='auditFix'){if(!window.confirm('تطبيق الإصلاح التلقائي الآمن على كل البطاقات القابلة للإصلاح؟'))return;e.target.disabled=true;try{const r=await api('/api/admin/card-audit',{method:'POST'});msg('أُصلحت '+r.fixed+' بطاقة، وحُدّث نص '+r.republished+' مادة منشورة.');load();}catch(error){msg(error.message);}finally{e.target.disabled=false;}}
  });
})();
