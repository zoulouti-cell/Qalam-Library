document.querySelector('#login').addEventListener('submit',async event=>{
  event.preventDefault();
  const message=document.querySelector('#message');
  message.textContent='جار التحقق…';
  try{
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.querySelector('#password').value})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'تعذر تسجيل الدخول.');
    location.replace('/');
  }catch(error){message.textContent=error.message;}
});
