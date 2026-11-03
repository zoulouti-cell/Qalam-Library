document.querySelector('#adminLogin').addEventListener('submit',async event=>{
  event.preventDefault();
  const message=document.querySelector('#message');
  message.textContent='جار التحقق…';
  try{
    const email=document.querySelector('#email').value.trim();
    const response=await fetch(email?'/api/login':'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(email?{email,password:document.querySelector('#password').value}:{password:document.querySelector('#password').value})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'تعذر تسجيل الدخول.');
    if(result.role!=='admin')throw new Error('هذا الحساب لا يملك صلاحية إدارة المكتبة.');
    location.replace(result.mustChangePassword?'/change-password':'/admin');
  }catch(error){message.textContent=error.message;}
});
