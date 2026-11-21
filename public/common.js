'use strict';
/* المكتبة المساعدة المشتركة لصفحات الإدارة والأرشيف: اتصال بالخادم موحّد ورسالة خطأ عربية، وتهريب النصوص قبل إدراجها في الصفحة.
   تُحمَّل قبل سائر السكربتات؛ وكل تعديل هنا يسري على كل الصفحات. */
(()=>{
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){
    const r=await fetch(url,{credentials:'same-origin',...options});let j={};try{j=await r.json();}catch{}
    if(!r.ok){const err=new Error(j.error||'تعذر إتمام الطلب.');err.data=j;err.status=r.status;throw err;}
    return j;
  }
  const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  window.Qalam=Object.freeze({esc,api,post});
})();
