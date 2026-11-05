document.querySelector('#login').addEventListener('submit',async event=>{
  event.preventDefault();
  const message=document.querySelector('#message');
  message.textContent='جار التحقق…';
  try{
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'تعذر تسجيل الدخول.');
    location.replace(result.mustChangePassword?'/change-password':'/');
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
