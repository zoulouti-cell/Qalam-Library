'use strict';
(()=>{
  const $=id=>document.getElementById(id),fmt=n=>new Intl.NumberFormat('ar-MA').format(Number(n)||0);
  let pollTimer=null,checking=false,pauseRequested=false;
  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',...options,headers:{...(options.headers||{}),'Content-Type':options.body?'application/json':(options.headers||{})['Content-Type']||'application/json'}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'تعذر إكمال الطلب.');
    return data;
  }
  function panelOpen(){return !$('ocrPanel').hidden;}
  async function loadSettings(){
    $('ocrSettingsStatus').textContent='جارٍ تحميل إعدادات OCR…';
    try{
      const data=await api('/api/admin/settings'),ocr=data.ocr||{};
      $('ocrEngine').value=ocr.engine||'local';$('ocrEngine').disabled=!!ocr.engineControlledByEnvironment;$('ocrWorkers').value=String(ocr.workers||2);$('ocrMaxPages').value=String(ocr.maxPages||0);$('geminiKey').value='';
      $('geminiStatus').textContent=ocr.geminiConfigured?(ocr.geminiConfiguredByEnvironment?'مفتاح Gemini متصل من متغيرات بيئة Render.': 'مفتاح Gemini محفوظ ومشفّر للمكتبة المستقلة.'):'لم يُسجّل مفتاح Gemini للمكتبة بعد.'+(ocr.engineControlledByEnvironment?' ويتحكم Render في تفعيل المحرك.':'');
      $('ocrSettingsStatus').textContent='';
    }catch(error){$('ocrSettingsStatus').textContent=error.message;}
  }
  async function saveSettings(event){
    event.preventDefault();$('saveOcrSettings').disabled=true;$('ocrSettingsStatus').textContent='جارٍ حفظ الإعدادات…';
    try{
      const data=await api('/api/admin/settings',{method:'POST',body:JSON.stringify({ocr:{engine:$('ocrEngine').value,workers:Number($('ocrWorkers').value)||2,maxPages:Number($('ocrMaxPages').value)||0,geminiApiKey:$('geminiKey').value}})});
      $('geminiKey').value='';const savedOcr=data.settings?.ocr||{};$('ocrEngine').disabled=!!savedOcr.engineControlledByEnvironment;$('geminiStatus').textContent=savedOcr.geminiConfigured?(savedOcr.geminiConfiguredByEnvironment?'مفتاح Gemini متصل من متغيرات بيئة Render.':'مفتاح Gemini محفوظ ومشفّر للمكتبة المستقلة.'):'لم يُسجّل مفتاح Gemini للمكتبة بعد.'+(savedOcr.engineControlledByEnvironment?' ويتحكم Render في تفعيل المحرك.':'');
      $('ocrSettingsStatus').textContent='حُفظت إعدادات OCR في قاعدة المكتبة المستقلة.';
    }catch(error){$('ocrSettingsStatus').textContent=error.message;}
    finally{$('saveOcrSettings').disabled=false;}
  }
  async function refreshProgress(schedule=true){
    clearTimeout(pollTimer);if(checking)return;checking=true;
    try{
      const data=await api('/api/editorial/ocr/worker'),progress=data.progress||{},done=Number(progress.completedPages)||0,total=Number(progress.totalPages)||0,percent=total?Math.max(0,Math.min(100,done*100/total)):0,active=!!data.running||!!data.workersActive;
      $('ocrPagesDone').textContent=fmt(data.ocrPages);$('ocrConfidence').textContent=data.meanConfidence==null?'—':Number(data.meanConfidence).toFixed(1)+'%';$('ocrReviewWords').textContent=fmt(data.lowConfidenceWords);$('ocrReviewRegions').textContent=fmt(data.reviewRegions);
      $('ocrSettingsProgressBar').style.width=percent.toFixed(1)+'%';$('ocrSettingsProgress').setAttribute('aria-valuenow',String(Math.round(percent)));
      const badge=$('ocrAdminState');badge.className='status-pill '+(active?'ok':'');badge.textContent=data.pauseRequested?'متوقف مؤقتاً':active?'قيد المعالجة':data.launchError?'تعذر التشغيل':progress.status==='complete'?'اكتملت الدفعة':progress.status==='not_scheduled'?'لم تبدأ المعالجة':'جاهز';
      $('ocrWorkerDetail').textContent=total?fmt(done)+' من '+fmt(total)+' صفحة · '+fmt(progress.completedDocuments)+' وثيقة اكتملت · '+fmt(progress.errors)+' حالات تعثر · تقدّم الدفعة '+percent.toFixed(1)+'%'+(progress.stale?' · لم يصل تحديث منذ مدة؛ تحقق من العامل.':''):(data.launchError?'تعذر تشغيل OCR المحلي: '+data.launchError:'عدد الصفحات المسجلة محلياً '+fmt(data.ocrPages)+'؛ لا توجد دفعة نشطة حالياً.');
      $('ocrStartBtn').disabled=active&&!data.pauseRequested;$('ocrStartBtn').textContent=data.pauseRequested?'استئناف المعالجة':active?'المعالجة جارية':'بدء المعالجة أو استئنافها';$('ocrPauseBtn').disabled=!active||!!data.pauseRequested;
      $('ocrHostingNote').hidden=!!data.localWorkerAvailable;if(!data.localWorkerAvailable){$('ocrHostingNote').textContent='عامل OCR المستمر يعمل على نسخة المكتبة المحلية فقط؛ خدمة Render لا تشغّل هذا العامل. إعداد المحرك السحابي هنا يخص OCR اليدوي لكل وثيقة من الأرشيف.';$('ocrStartBtn').disabled=true;$('ocrPauseBtn').disabled=true;}
      if(schedule&&panelOpen())pollTimer=setTimeout(()=>refreshProgress(true),active||data.pauseRequested?4000:20000);
    }catch(error){
      $('ocrAdminState').className='status-pill bad';$('ocrAdminState').textContent='حالة العامل المحلي غير متاحة';$('ocrWorkerDetail').textContent='تعذر قراءة تقدّم OCR المحلي: '+error.message;
      if(/محلياً على هذا الجهاز|403|غير متاح/.test(error.message)){
        $('ocrHostingNote').hidden=false;$('ocrHostingNote').textContent='عامل OCR المستمر يعمل على نسخة المكتبة المحلية فقط؛ خدمة Render لا تشغّل هذا العامل. يمكن إعداد المحرك السحابي هنا وتشغيل OCR لكل وثيقة يدوياً من الأرشيف.';
        $('ocrStartBtn').disabled=true;$('ocrPauseBtn').disabled=true;
      }
    }finally{checking=false;}
  }
  async function control(action){
    $('ocrStartBtn').disabled=true;$('ocrPauseBtn').disabled=true;$('ocrWorkerDetail').textContent=action==='pause'?'جارٍ طلب الإيقاف المؤقت بعد انتهاء الصفحة الحالية…':'جارٍ تشغيل OCR المحلي…';
    try{await api('/api/editorial/ocr/worker',{method:'POST',body:JSON.stringify({action,workers:Number($('ocrWorkers').value)||2,maxPages:Math.max(0,Math.min(10000,Number($('ocrMaxPages').value)||0))})});pauseRequested=action==='pause';await refreshProgress(false);}
    catch(error){$('ocrWorkerDetail').textContent=error.message;$('ocrStartBtn').disabled=false;$('ocrPauseBtn').disabled=false;}
  }
  document.querySelector('.admin-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-panel]');if(tab?.dataset.panel==='ocrPanel'){loadSettings();refreshProgress(true);}else clearTimeout(pollTimer);});
  $('ocrConfigForm').addEventListener('submit',saveSettings);
  $('ocrRefreshBtn').addEventListener('click',()=>refreshProgress(false));
  $('ocrStartBtn').addEventListener('click',()=>control($('ocrStartBtn').textContent==='استئناف المعالجة'?'resume':'start'));
  $('ocrPauseBtn').addEventListener('click',()=>control('pause'));
})();
