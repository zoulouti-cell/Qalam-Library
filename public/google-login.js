const googleButton=document.querySelector('#googleLogin');
const googleHint=document.querySelector('#googleHint');
const adminDestination=new URLSearchParams(location.search).get('next')==='admin';
if(googleButton&&adminDestination)googleButton.dataset.destination='admin';
if(googleButton){
  fetch('/api/auth/google/status').then(response=>response.json()).then(status=>{
    if(status.available){googleButton.disabled=false;if(googleHint)googleHint.textContent='استخدم حساب Google المرتبط ببريدك المفعّل في المكتبة.';}
    else if(googleHint)googleHint.textContent='دخول Google بانتظار إتمام إعدادات المكتبة.';
  }).catch(()=>{if(googleHint)googleHint.textContent='تعذر التحقق من توفر دخول Google الآن.';});
  googleButton.addEventListener('click',()=>{location.assign(`/api/auth/google/start?destination=${googleButton.dataset.destination==='admin'?'admin':'reader'}`);});
}
const reason=new URLSearchParams(location.search).get('google_error');
if(reason){
  const message=document.querySelector('#message');
  if(message)message.textContent={account:'هذا الحساب غير موجود في المكتبة أو لم يُفعّل بعد.',link:'لا يمكن ربط هذا البريد تلقائياً. ادخل بكلمة المرور وراجع الإدارة.',admin:'هذا الحساب لا يملك صلاحية إدارة المكتبة.',failed:'تعذر إتمام الدخول عبر Google. حاول مجدداً.'}[reason]||'تعذر إتمام الدخول عبر Google.';
}
