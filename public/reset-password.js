const themeToggle=document.querySelector('#themeToggle');
if(themeToggle){let saved='';try{saved=localStorage.getItem('qalam-library-login-theme')||''}catch{}const apply=dark=>{document.body.classList.toggle('dark',dark);themeToggle.innerHTML=dark?'<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>':'<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';themeToggle.setAttribute('aria-pressed',String(dark));try{localStorage.setItem('qalam-library-login-theme',dark?'dark':'light')}catch{}};apply(saved==='dark');themeToggle.addEventListener('click',()=>apply(!document.body.classList.contains('dark')));}
/* الرمز يصل بعد # فلا يرسله المتصفح إلى الخادم ولا في Referer؛ يُحفظ في المتغير ثم يُزال من العنوان. */
const token=new URLSearchParams(location.hash.replace(/^#/,'')).get('token')||'';
if(token)history.replaceState(null,'',location.pathname);
/* لصق رابط جديد في صفحة مفتوحة يغيّر الجزء بعد # دون إعادة تحميل؛ نعيد التحميل ليُقرأ الرمز الجديد. */
addEventListener('hashchange',()=>location.reload());
const form=document.querySelector('#resetForm'),message=document.querySelector('#message');
const lock=()=>form.querySelectorAll('input,button').forEach(element=>{element.disabled=true;});
if(!token){message.textContent='رابط الاستعادة ناقص أو غير صالح. اطلب رابطاً جديداً من صفحة «نسيت كلمة المرور؟».';lock();}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const password=document.querySelector('#newPassword').value;
  if(password!==document.querySelector('#confirmPassword').value){message.textContent='كلمتا المرور غير متطابقتين.';return;}
  message.textContent='جارٍ الحفظ…';
  try{
    const response=await fetch('/api/password-reset/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'تعذر تغيير كلمة المرور.');
    message.textContent=result.message||'تم تغيير كلمة المرور. يمكنك تسجيل الدخول الآن.';lock();
  }catch(error){message.textContent=error.message;}
});
