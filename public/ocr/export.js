document.addEventListener('click', async event => {
  const button = event.target.closest('[data-ocr-save],[data-ocr-share]');
  if (!button) return;
  const field = document.getElementById(button.dataset.ocrSave || button.dataset.ocrShare);
  const text = field?.value.trim();
  if (!text) { field?.focus(); return; }
  const title = (document.getElementById('scannerTitle')?.value || document.getElementById('fTitle')?.value || 'نص الوثيقة').trim();
  const file = new File([text], title + '.txt', {type:'text/plain'});
  if (button.dataset.ocrShare && navigator.share) {
    try { await navigator.share(navigator.canShare?.({files:[file]}) ? {files:[file]} : {title, text}); }
    catch (error) { if (error.name !== 'AbortError') alert('تعذرت المشاركة. يمكن حفظ النص من الزر المجاور.'); }
  } else if (button.dataset.ocrShare) {
    try { await navigator.clipboard.writeText(text); alert('نُسخ النص للمشاركة.'); }
    catch { field.select(); }
  } else {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file); link.download = file.name;
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
});
