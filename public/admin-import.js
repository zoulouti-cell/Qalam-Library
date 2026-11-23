'use strict';
/* استيراد بطاقات الراصد من نص JSON: لمن يُعدّ البطاقات خارج المنصة (مثل ChatGPT) دون رمز الراصد.
   تُرسل كل بطاقة بجلسة المدير إلى المسار نفسه الذي يستعمله الجامع، فتسري عليها القواعد نفسها
   (القالب، منع التكرار، الحجز، ما حذفه المدير لا يعود). */
(()=>{
  const host=document.getElementById('legalMonitorPanel');if(!host||document.getElementById('monitorImport'))return;
  const {esc,api}=window.Qalam;
  const box=document.createElement('section');box.id='monitorImport';box.className='panel';
  box.innerHTML='<h3>استيراد بطاقات (JSON)</h3><p class="muted">الصق هنا البطاقات التي أعدّها مساعد خارجي بصيغة JSON: بطاقة واحدة أو قائمة بطاقات. تُسجَّل كما يسجّلها الجامع تماماً، فلا حاجة إلى رمز الراصد.</p><textarea id="monitorImportText" rows="8" dir="ltr" spellcheck="false" style="width:100%;font-family:var(--q-font-mono,monospace);font-size:12.5px" placeholder="[ { &quot;country&quot;: &quot;fr&quot;, &quot;kind&quot;: &quot;case_law&quot;, &quot;title&quot;: &quot;…&quot;, … } ]"></textarea><p><button type="button" id="monitorImportRun">استيراد</button></p><div id="monitorImportResult" role="status"></div>';
  host.append(box);
  const out=document.getElementById('monitorImportResult');
  const parse=text=>{
    let s=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();
    const v=JSON.parse(s);
    if(Array.isArray(v))return v;
    if(v&&Array.isArray(v.items))return v.items;
    if(v&&typeof v==='object')return [v];
    throw new Error('الصيغة غير مفهومة.');
  };
  document.getElementById('monitorImportRun').addEventListener('click',async e=>{
    let items;try{items=parse(document.getElementById('monitorImportText').value);}catch(error){out.innerHTML='<p class="muted">تعذّرت قراءة النص: '+esc(error.message)+'</p>';return;}
    if(!items.length){out.innerHTML='<p class="muted">لا توجد بطاقات.</p>';return;}
    e.target.disabled=true;const rows=[];
    for(const [i,item] of items.entries()){
      const title=item?.title||item?.originalTitle||('بطاقة '+(i+1));
      try{const r=await api('/api/admin/legal-monitor/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});
        const note=r.skipped||r.dismissed?'محذوفة سابقاً بقرار المدير؛ لم تُستورد':r.merged||r.updated?'دُمجت في بطاقتها القائمة':(r.item?.state==='held'||r.state==='held')?'سُجّلت محجوزة'+(r.item?.holdReason||r.holdReason?' — '+(r.item?.holdReason||r.holdReason):''):'سُجّلت';
        rows.push('<li>'+esc(title)+' — <strong>'+esc(note)+'</strong></li>');}
      catch(error){rows.push('<li>'+esc(title)+' — <strong class="danger-text">رُفضت: '+esc(error.message)+'</strong></li>');}
      out.innerHTML='<ul>'+rows.join('')+'</ul>';
    }
    e.target.disabled=false;
    document.querySelector('[data-panel="legalMonitorPanel"]')?.click();
  });
})();
