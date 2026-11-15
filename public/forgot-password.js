const themeToggle=document.querySelector('#themeToggle');
if(themeToggle){let saved='';try{saved=localStorage.getItem('qalam-library-login-theme')||''}catch{}const apply=dark=>{document.body.classList.toggle('dark',dark);themeToggle.innerHTML=dark?'<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>':'<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';themeToggle.setAttribute('aria-pressed',String(dark));try{localStorage.setItem('qalam-library-login-theme',dark?'dark':'light')}catch{}};apply(saved==='dark');themeToggle.addEventListener('click',()=>apply(!document.body.classList.contains('dark')));}
document.querySelector('#forgotForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const message=document.querySelector('#message'),button=event.target.querySelector('button[type="submit"]'),email=document.querySelector('#email').value.trim();
  message.textContent='جارٍ الإرسال…';button.disabled=true;
  try{
    const response=await fetch('/api/password-reset/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'تعذر إرسال الطلب.');
    message.textContent=(result.message||'')+' إن لم تجد الرسالة فتفقّد مجلد الرسائل غير المرغوب فيها.';
    // فاصل 60 ثانية بين طلبين يوافق فاصل الخادم.
    setTimeout(()=>{button.disabled=false;},60000);
  }catch(error){message.textContent=error.message;button.disabled=false;}
});
