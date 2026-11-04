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

  async function loadOcrLibraries() {
    say('جارٍ تحميل قارئ PDF ومحرك OCR وبيانات اللغة عند أول استخدام…');
    const [pdfjs, tesseract] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs'),
      import('https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.esm.min.js'),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
    return { pdfjs, tesseract };
  }

  async function recognizeImage(worker, file) {
    const bitmap = await createImageBitmap(file);
    const maxSide = 3000;
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const result = await worker.recognize(canvas);
    canvas.width = canvas.height = 0;
    return String(result.data.text || '').trim();
  }

  async function recognizePdf(pdfjs, worker, file, maxPages, fileIndex, fileCount) {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const totalPages = pdf.numPages;
    const count = Math.min(maxPages, totalPages);
    const pages = [];
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      say(`قراءة ${file.name} — الصفحة ${pageNumber} من ${count} · الملف ${fileIndex} من ${fileCount}`);
      progress(((fileIndex - 1 + pageNumber / count) / fileCount) * 100);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas);
      const text = String(result.data.text || '').trim();
      if (text) pages.push(`— ${file.name} · الصفحة ${pageNumber} —\n${text}`);
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    await pdf.destroy();
    return { text: pages.join('\n\n'), pages: count, totalPages };
  }

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
    let worker;
    try {
      const { pdfjs, tesseract } = await loadOcrLibraries();
      const language = $('scannerLanguage').value;
      worker = await tesseract.createWorker(language, 1, {
        logger: (message) => {
          if (message.status === 'recognizing text') {
            say(`OCR محلي: ${Math.round((message.progress || 0) * 100)}٪ من الصفحة الحالية…`);
          }
        },
      });
      const limit = Math.max(1, Math.min(30, Number($('scannerMaxPages').value) || 10));
      const results = [];
      let completedPages = 0;
      for (let i = 0; i < selectedFiles.length; i += 1) {
        const file = selectedFiles[i];
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          const result = await recognizePdf(pdfjs, worker, file, limit, i + 1, selectedFiles.length);
          results.push(result.text);
          completedPages += result.pages;
          if (result.totalPages > result.pages) {
            say(`عولجت أول ${result.pages} صفحات من ${file.name} (إجمالي ${result.totalPages}).`);
          }
        } else if (file.type.startsWith('image/')) {
          say(`قراءة الصورة ${file.name} · الملف ${i + 1} من ${selectedFiles.length}…`);
          progress(((i + 0.5) / selectedFiles.length) * 100);
          const text = await recognizeImage(worker, file);
          results.push(`— ${file.name} —\n${text}`);
          completedPages += 1;
        } else {
          throw new Error(`نوع الملف غير مدعوم: ${file.name}`);
        }
        progress(((i + 1) / selectedFiles.length) * 100);
      }
      const text = results.filter(Boolean).join('\n\n');
      if (text.trim().length < 40) throw new Error('الناتج قصير أو فارغ. جرّب صورة أوضح أو تحقق من لغة OCR.');
      $('scannerText').value = text;
      $('saveScannerDraft').disabled = false;
      say(`اكتملت القراءة محلياً: ${completedPages} صفحة/صورة. راجع النص وصححه قبل حفظ المسودة.`, 'ok');
      progress(100);
    } catch (error) {
      say(error.message || 'تعذرت القراءة الضوئية. تحقق من الاتصال عند تحميل أدوات OCR أول مرة.', 'error');
    } finally {
      if (worker) await worker.terminate().catch(() => {});
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

