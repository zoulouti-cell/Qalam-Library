(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const dialog = $('scannerReader');
  if (!dialog) return;

  let selectedFiles = [];
  let busy = false;
  const say = (text, kind = '') => {
    const node = $('scannerStatus');
    node.textContent = text;
    node.dataset.kind = kind;
  };
  const progress = (value) => {
    const pct = Math.max(0, Math.min(100, Math.round(value)));
    $('scannerProgressBar').style.width = `${pct}%`;
    $('scannerProgressBar').parentElement.setAttribute('aria-valuenow', String(pct));
  };
  const syncFiles = (input) => {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    selectedFiles = files;
    $('scannerFileNames').textContent = files.length === 1
      ? files[0].name
      : `${files.length} ملفات محددة: ${files.slice(0, 3).map((f) => f.name).join('، ')}${files.length > 3 ? '…' : ''}`;
    if (!$('scannerTitle').value.trim() && files.length === 1) {
      $('scannerTitle').value = files[0].name.replace(/\.(pdf|png|jpe?g|webp|tiff?)$/i, '').replace(/[_-]+/g, ' ');
    }
    $('scannerText').value = '';
    $('saveScannerDraft').disabled = true;
    $('openScannerDraft').hidden = true;
    progress(0);
    say('تم اختيار الملفات. اضغط «قراءة ضوئية محلية» لبدء المعالجة.');
  };
  ['scanFolderInput', 'scanCameraInput', 'scanReaderInput'].forEach((id) => {
    $(id).addEventListener('change', (event) => syncFiles(event.currentTarget));
  });

  $('openScannerReader').addEventListener('click', () => {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
  $('closeScannerReader').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  $('runScannerOcr').addEventListener('click', async (event) => {
    if (busy) return;
    if (!selectedFiles.length) {
      say('اختر ملف PDF أو صورة أو التقط صورة بالكاميرا أولاً.', 'error');
      return;
    }
    busy = true;
    const button = event.currentTarget;
    button.disabled = true;
    $('saveScannerDraft').disabled = true;
    $('openScannerDraft').hidden = true;
    $('scannerText').value = '';
    progress(1);
    try {
      const result = await window.QalamReader.read(selectedFiles, {
        lang: $('scannerLanguage').value,
        maxPages: Math.max(1, Math.min(30, Number($('scannerMaxPages').value) || 10)),
        onProgress: (ratio, message) => { if (ratio !== null) progress(ratio * 100); if (message) say(message); }
      });
      const { text, pages: completedPages } = result;
      if (!text.trim()) throw new Error('الناتج قصير أو فارغ. جرّب صورة أوضح أو تحقق من لغة OCR.');
      $('scannerText').value = text;
      $('saveScannerDraft').disabled = false;
      say(result.notes.length ? result.notes.join(' · ') : `اكتملت القراءة محلياً: ${completedPages} صفحة/صورة. راجع النص وصححه قبل حفظ المسودة.`, 'ok');
      progress(100);
    } catch (error) {
      say(error.message || 'تعذرت القراءة الضوئية. تحقق من الاتصال عند تحميل أدوات OCR أول مرة.', 'error');
    } finally {
      busy = false;
      button.disabled = false;
    }
  });

  $('scannerText').addEventListener('input', () => {
    $('saveScannerDraft').disabled = $('scannerText').value.trim().length < 40;
  });

  $('saveScannerDraft').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const title = $('scannerTitle').value.trim();
    const sourceUrl = $('scannerSourceUrl').value.trim();
    const text = $('scannerText').value.trim();
    if (title.length < 3 || text.length < 40) return say('أدخل عنوان الوثيقة وتحقق من اكتمال النص المستخرج.', 'error');
    if (!/^https:\/\//i.test(sourceUrl)) return say('أدخل رابط المصدر الرسمي بصيغة HTTPS قبل الحفظ.', 'error');
    if (text.length > 1_500_000) return say('النص كبير جداً لمسودة واحدة؛ قسّمه إلى وثيقتين أو أكثر.', 'error');
    button.disabled = true;
    say('جارٍ حفظ النص والبيانات الوصفية كمسودة غير منشورة…');
    try {
      const response = await fetch('/api/admin/content/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          text,
          type: $('scannerType').value,
          kind: $('scannerKind').value,
          category: $('scannerCategory').value.trim() || 'غير مصنف — مراجعة التصنيف',
          subcategory: '',
          date: $('scannerDate').value.trim(),
          sourceUrl,
          sourceLabel: 'مصدر رسمي · OCR محلي من المتصفح',
          reason: $('scannerReason').value.trim() || 'مسودة OCR محلية؛ يلزم تدقيق النص كاملاً ومقارنته بالمصدر الرسمي قبل النشر.',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'تعذر حفظ المسودة. تحقق من اتصال الإدارة بقاعدة البيانات.');
      const link = $('openScannerDraft');
      link.href = `/admin?draft=${encodeURIComponent(data.documentId)}`;
      link.hidden = false;
      say('حُفظت المسودة بنجاح، ولم تُنشر. افتحها للمراجعة النهائية.', 'ok');
      window.dispatchEvent(new CustomEvent('qalam:scanner-draft-saved', { detail: { id: data.documentId } }));
    } catch (error) {
      say(error.message || 'تعذر حفظ المسودة.', 'error');
    } finally {
      button.disabled = false;
    }
  });
})();

