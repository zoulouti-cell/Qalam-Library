document.querySelector('#login').addEventListener('submit',async event=>{
  event.preventDefault();
  const message=document.querySelector('#message');
  message.textContent='جار التحقق…';
  try{
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'تعذر تسجيل الدخول.');
    const adminDestination=new URLSearchParams(location.search).get('next')==='admin';
    if(adminDestination&&result.role!=='admin')throw new Error('هذا الحساب لا يملك صلاحية إدارة المكتبة.');
    location.replace(result.mustChangePassword?'/change-password':adminDestination?'/admin':'/');
  }catch(error){message.textContent=error.message;}
});

const themeToggle=document.querySelector('#themeToggle');
if(themeToggle){
  const setTheme=dark=>{
    document.body.classList.toggle('dark',dark);
    themeToggle.textContent=dark?'☀':'☾';
    themeToggle.setAttribute('aria-pressed',String(dark));
    try{localStorage.setItem('qalam-library-login-theme',dark?'dark':'light');}catch{}
  };
  let saved='';
  try{saved=localStorage.getItem('qalam-library-login-theme')||'';}catch{}
  setTheme(saved==='dark');
  themeToggle.addEventListener('click',()=>setTheme(!document.body.classList.contains('dark')));
}

fetch('/api/registration').then(r=>r.json()).then(status=>{
  if(status.available)document.querySelector('#registrationArea').hidden=false;
}).catch(()=>{});
document.querySelector('#showRegistration').addEventListener('click',()=>{
  const form=document.querySelector('#registerForm');form.hidden=!form.hidden;
  if(!form.hidden)document.querySelector('#registerEmail').focus();
});
document.querySelector('#registerForm').addEventListener('submit',async event=>{
  event.preventDefault();const message=document.querySelector('#registerMessage');message.textContent='جارٍ إرسال الدعوة…';
  try{
    const response=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#registerEmail').value})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'تعذر طلب الحساب.');
    message.textContent=result.message||'تحقق من بريدك الإلكتروني لتفعيل الحساب.';
  }catch(error){message.textContent=error.message;}
});
