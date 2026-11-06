const themeToggle=document.querySelector('#themeToggle');
if(themeToggle){let saved='';try{saved=localStorage.getItem('qalam-library-login-theme')||''}catch{}const apply=dark=>{document.body.classList.toggle('dark',dark);themeToggle.innerHTML=dark?'<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>':'<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';themeToggle.setAttribute('aria-pressed',String(dark));try{localStorage.setItem('qalam-library-login-theme',dark?'dark':'light')}catch{}};apply(saved==='dark');themeToggle.addEventListener('click',()=>apply(!document.body.classList.contains('dark')));}
document.querySelector('#activationForm').addEventListener('submit',async event=>{
  event.preventDefault();const message=document.querySelector('#message'),password=document.querySelector('#newPassword').value;
  if(password!==document.querySelector('#confirmPassword').value){message.textContent='كلمتا المرور غير متطابقتين.';return;}
  const token=new URLSearchParams(location.search).get('token')||'';message.textContent='جارٍ تفعيل الحساب…';
  try{const response=await fetch('/api/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password})});const result=await response.json();if(!response.ok)throw new Error(result.error||'تعذر التفعيل.');history.replaceState(null,'','/activate');message.textContent=result.message||'تم التفعيل. يمكنك تسجيل الدخول الآن.';document.querySelector('#activationForm button[type=submit]').disabled=true;
    // إن بدأ المستخدم من رابط وثيقة بعينها (?doc=) قبل إنشاء حسابه، يعود رابط «تسجيل الدخول» إليها بعد التفعيل.
    let pendingDoc='';try{pendingDoc=sessionStorage.getItem('qalam.library.pendingDoc')||'';}catch{}
    if(pendingDoc){const link=document.querySelector('.registration-area a[href="/login"]');if(link)link.href='/login?doc='+encodeURIComponent(pendingDoc);try{sessionStorage.removeItem('qalam.library.pendingDoc');}catch{}}
  }
  catch(error){message.textContent=error.message;}
});
