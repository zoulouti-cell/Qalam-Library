'use strict';
/* سلة المحذوفات: بطاقات المستجدات المحذوفة تبقى 30 يوماً وتُستعاد بزر واحد، أو تُحذف نهائياً بأمر المدير. */
(()=>{
  const tabs=document.querySelector('.admin-tabs');if(!tabs||document.getElementById('trashPanel'))return;
  const {esc,api}=window.Qalam;
  const day=d=>{try{return new Intl.DateTimeFormat('ar-MA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(d));}catch{return '';}};
  const tab=document.createElement('button');tab.type='button';tab.dataset.panel='trashPanel';tab.innerHTML='<span class="tab-n">9</span>سلة المحذوفات';tabs.append(tab);
  const panel=document.createElement('div');panel.id='trashPanel';panel.className='tab-panel';panel.hidden=true;
  panel.innerHTML='<header class="topic-head"><div><h2>سلة المحذوفات</h2><p>بطاقات المستجدات المحذوفة من المكتبة. تُستعاد كما كانت (البطاقة ومادتها المنشورة)، وتُمحى نهائياً تلقائياً بعد 30 يوماً من حذفها.</p></div></header><section class="panel"><div id="trashList"><p class="muted">جارٍ التحميل…</p></div><p id="trashMessage" class="muted" role="status"></p></section>';
  (document.getElementById('legalMonitorPanel')||tabs).after(panel);
  const list=()=>document.getElementById('trashList'),msg=t=>{document.getElementById('trashMessage').textContent=t||'';};
  async function load(){
    try{const {items=[]}=await api('/api/admin/trash');
      list().innerHTML=items.length?'<table class="data-table"><thead><tr><th>العنوان</th><th>الفرع</th><th>حُذف في</th><th>يُمحى في</th><th></th></tr></thead><tbody>'+items.map(x=>'<tr><td>'+esc(x.label)+(x.publishedCount?' <small class="muted">(كانت منشورة)</small>':'')+'</td><td>'+esc(x.category||'—')+'</td><td>'+esc(day(x.deletedAt))+'</td><td>'+esc(day(x.purgeAt))+'</td><td><button type="button" data-trash-restore="'+esc(x.id)+'">استعادة</button> <button type="button" class="danger" data-trash-purge="'+esc(x.id)+'" data-title="'+esc(x.label)+'">حذف نهائي</button></td></tr>').join('')+'</tbody></table>':'<p class="muted">السلة فارغة.</p>';
    }catch(error){list().innerHTML='<p class="muted">'+esc(error.message)+'</p>';}
  }
  tabs.addEventListener('click',e=>{if(e.target.closest('[data-panel]')?.dataset.panel==='trashPanel'){msg('');load();}});
  panel.addEventListener('click',async e=>{
    const restore=e.target.closest('[data-trash-restore]'),purge=e.target.closest('[data-trash-purge]');if(!restore&&!purge)return;
    if(purge&&!window.confirm('حذف «'+purge.dataset.title+'» نهائياً؟ لا يمكن التراجع عن ذلك.'))return;
    const b=restore||purge;b.disabled=true;
    try{await api('/api/admin/trash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:restore?restore.dataset.trashRestore:purge.dataset.trashPurge,action:restore?'restore':'purge'})});msg(restore?'استُعيدت البطاقة إلى مكانها.':'حُذفت نهائياً.');load();}
    catch(error){b.disabled=false;msg(error.message);}
  });
})();
