// تسجيل عامل الخدمة هنا أيضاً: يُتيح للمتصفح تنصيب المكتبة من شاشة الدخول قبل أي تسجيل دخول.
try{if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});}catch(e){}

document.querySelector('#login').addEventListener('submit',async event=>{
  event.preventDefault();
  const message=document.querySelector('#message');
  message.textContent='جار التحقق…';
  try{
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value})});
    const result=await response.json();
    if(!response.ok){
      if(result.state==='review'){showPending();message.textContent='';return;}
      if(result.state==='rejected'){const area=document.querySelector('#registrationArea'),form=document.querySelector('#registerForm');if(area)area.hidden=false;if(form)form.hidden=false;}
      throw new Error(result.error||'تعذر تسجيل الدخول.');
    }
    const params=new URLSearchParams(location.search);
    const adminDestination=params.get('next')==='admin';
    if(adminDestination&&result.role!=='admin')throw new Error('هذا الحساب لا يملك صلاحية إدارة المكتبة.');
    // رابط مباشر لوثيقة بعينها (?doc=) يُحفظ عبر الدخول فيعود المستخدم إليها بعد تسجيل الدخول.
    const docId=params.get('doc'),needle=params.get('q');
    const home=docId?('/?doc='+encodeURIComponent(docId)+(needle?'&q='+encodeURIComponent(needle):'')):'/';
    location.replace(result.mustChangePassword?'/change-password':adminDestination?'/admin':home);
  }catch(error){message.textContent=error.message;}
});

const themeToggle=document.querySelector('#themeToggle');
if(themeToggle){
  const setTheme=dark=>{
    document.body.classList.toggle('dark',dark);
    themeToggle.innerHTML=dark?'<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>':'<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
    themeToggle.setAttribute('aria-pressed',String(dark));
    try{localStorage.setItem('qalam-library-login-theme',dark?'dark':'light');}catch{}
  };
  let saved='';
  try{saved=localStorage.getItem('qalam-library-login-theme')||'';}catch{}
  setTheme(saved==='dark');
  themeToggle.addEventListener('click',()=>setTheme(!document.body.classList.contains('dark')));
}

function showPending(){document.body.classList.add('pending-mode');document.querySelector('#pendingPanel').hidden=false;}
document.querySelector('#pendingBack').addEventListener('click',()=>{document.body.classList.remove('pending-mode');document.querySelector('#pendingPanel').hidden=true;document.querySelector('#email').focus();});
if(new URLSearchParams(location.search).get('pending')==='1'){showPending();try{history.replaceState(null,'',location.pathname);}catch{}}
fetch('/api/registration').then(r=>r.json()).then(status=>{
  if(status.available)document.querySelector('#registrationArea').hidden=false;
}).catch(()=>{});
document.querySelector('#showRegistration').addEventListener('click',()=>{
  const form=document.querySelector('#registerForm');form.hidden=!form.hidden;
  if(!form.hidden)document.querySelector('#registerEmail').focus();
});
document.querySelector('#registerForm').addEventListener('submit',async event=>{
  event.preventDefault();const message=document.querySelector('#registerMessage');message.textContent='جارٍ إرسال الطلب…';
  try{
    const response=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#registerEmail').value,password:document.querySelector('#registerPassword').value})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'تعذر طلب الحساب.');
    message.textContent=result.message||'تحقق من بريدك الإلكتروني لتأكيد التسجيل.';document.querySelector('#registerPassword').value='';
    // رابط مباشر لوثيقة بعينها (?doc=) يُحفظ هنا حتى يعود المستخدم إليها بعد تفعيل حسابه وتسجيل الدخول لاحقاً، ولو في المتصفح نفسه فقط.
    const docId=new URLSearchParams(location.search).get('doc');
    if(docId){try{sessionStorage.setItem('qalam.library.pendingDoc',docId);}catch{}}
  }catch(error){message.textContent=error.message;}
});
