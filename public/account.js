const accountDate = value => value ? new Date(value).toLocaleString('ar-MA',{dateStyle:'medium',timeStyle:'short'}) : '—';
fetch('/api/account/profile',{credentials:'same-origin'}).then(async response => {
  const data=await response.json();if(!response.ok)throw new Error(data.error||'تعذر عرض الحساب.');
  document.querySelector('#accountEmail').textContent=data.email||'الدخول المشترك';
  document.querySelector('#accountRole').textContent=data.role==='admin'?'مدير المكتبة':'قارئ';
  document.querySelector('#accountCreated').textContent=accountDate(data.createdAt);
  document.querySelector('#accountLastLogin').textContent=accountDate(data.lastLoginAt);
  document.querySelector('#accountGoogle').textContent=data.googleLinked?'مرتبط':'غير مرتبط';
  document.querySelector('#passwordPanel').hidden=!data.canChangePassword;
  document.querySelector('#accountNote').textContent=data.individual?'إعدادات القراءة والبحث تبقى محفوظة على هذا الجهاز.':'هذا دخول مشترك؛ أنشئ حساباً فردياً لحفظ بيانات الدخول الخاصة بك.';
}).catch(error=>{document.querySelector('#accountEmail').textContent=error.message;});
document.querySelector('#passwordForm').addEventListener('submit',async event=>{
  event.preventDefault();const status=document.querySelector('#passwordStatus');status.textContent='جارٍ الحفظ…';
  try{const response=await fetch('/api/account/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.querySelector('#currentPassword').value,newPassword:document.querySelector('#newPassword').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'تعذر تغيير كلمة المرور.');event.target.reset();status.textContent='حُفظت كلمة المرور الجديدة.';}catch(error){status.textContent=error.message;}
});
document.querySelector('#logout').addEventListener('click',async()=>{try{await fetch('/api/logout',{method:'POST'});}finally{location.replace('/login');}});
