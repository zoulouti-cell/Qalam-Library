'use strict';
/* محرك قراءة النصوص لإضافات المستخدمين — يعمل كله داخل المتصفح.
   - PDF نصي: تُقرأ طبقة النص مباشرة، فإن بدت مشوّهة (شائع في العربية) أو خلت من نص تُقرأ الصفحة ضوئيًا.
   - الصور وPDF الممسوح: تعرّف ضوئي على الحروف (العربية والفرنسية) بـ Tesseract.
   - Word وtxt: يستخرجهما الخادم عبر /api/contributions/extract.
   - مجلد الماسح: واجهة File System Access (Chrome وEdge على الحاسوب).
   لا قراءة فائقة الدقة عبر نماذج خارجية في المكتبة: القراءة محلية دائمًا. */
(() => {
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
  const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.esm.min.js';
  const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
  const isPdf = file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file => /^image\/(jpeg|png|webp)$/.test(file.type) || IMAGE_RE.test(file.name);
  const isServerText = file => /\.(docx|txt|text|md)$/i.test(file.name);

  /* ───────── جودة النص: كلمات الوظيفة الشائعة تدلّ على قراءة سليمة، وغيابها يدل على تشويه ───────── */
  const normAr = value => String(value || '').normalize('NFKC').replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').toLowerCase();
  const STOP = new Set(['في', 'من', 'علي', 'الي', 'عن', 'ان', 'التي', 'الذي', 'هذا', 'هذه', 'ذلك', 'كل', 'لا', 'ما', 'قد', 'او', 'ثم', 'اذا', 'كان', 'كانت', 'بين', 'عند', 'حيث', 'لم', 'لن', 'مع', 'بعد', 'قبل', 'de', 'la', 'le', 'les', 'des', 'du', 'et', 'en', 'un', 'une', 'que', 'qui', 'pour', 'par', 'dans', 'sur', 'au', 'est', 'ce', 'cette'].map(normAr));
  function textQuality(text) {
    const tokens = String(text || '').normalize('NFKC').split(/[^\p{L}\p{M}]+/u).filter(Boolean);
    if (tokens.length < 8) return { ok: false, words: tokens.length, ratio: 0 };
    const hits = tokens.filter(t => STOP.has(normAr(t))).length, ratio = hits / tokens.length;
    const avg = tokens.reduce((n, t) => n + t.length, 0) / tokens.length;
    return { ok: ratio >= 0.035 && avg >= 2.2 && avg <= 12, words: tokens.length, ratio };
  }
  const tidy = text => String(text || '').normalize('NFKC').replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  const withTimeout = (promise, ms, message) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(message)), ms); promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); }); });

  /* ───────── المكتبات الخارجية تُحمَّل عند أول استعمال فقط ───────── */
  let pdfjsPromise = null, tesseractPromise = null;
  const loadPdfjs = () => pdfjsPromise || (pdfjsPromise = withTimeout(import(PDFJS), 40000, 'timeout').then(m => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; }).catch(() => { pdfjsPromise = null; throw new Error('تعذر تحميل قارئ PDF؛ تحققوا من الاتصال بالإنترنت ثم أعيدوا المحاولة.'); }));
  const loadTesseract = () => tesseractPromise || (tesseractPromise = withTimeout(import(TESSERACT), 40000, 'timeout').catch(() => { tesseractPromise = null; throw new Error('تعذر تحميل محرك التعرف الضوئي؛ تحققوا من الاتصال بالإنترنت ثم أعيدوا المحاولة.'); }));

  /* ───────── معالجة الصور ───────── */
  async function toBitmap(source) { return createImageBitmap(source); }
  function drawScaled(bitmap, maxSide) {
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  /* رمادي + مدّ التباين (من 2٪ إلى 98٪) يحسّن قراءة صور الهاتف الباهتة */
  function enhanceForOcr(canvas) {
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true }), image = context.getImageData(0, 0, canvas.width, canvas.height), data = image.data, hist = new Uint32Array(256);
      for (let i = 0; i < data.length; i += 4) { const g = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 | 0; data[i] = g; hist[g]++; }
      const total = data.length / 4; let acc = 0, lo = 0, hi = 255;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
      acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
      if (hi - lo < 40) { lo = 0; hi = 255; }
      const scale = 255 / (hi - lo);
      for (let i = 0; i < data.length; i += 4) { const g = Math.max(0, Math.min(255, ((data[i] - lo) * scale) | 0)); data[i] = data[i + 1] = data[i + 2] = g; }
      context.putImageData(image, 0, 0);
    } catch { /* نكتفي بالصورة كما هي */ }
    return canvas;
  }
  const canvasToBlob = (canvas, quality = 0.86) => new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  /* ضغط الصورة قبل رفعها أصلًا: يخفّف الرفع والتخزين المؤقت على الخادم */
  async function compressImage(file, { maxSide = 2600, quality = 0.86 } = {}) {
    const bitmap = await toBitmap(file), canvas = drawScaled(bitmap, maxSide); bitmap.close?.();
    const blob = await canvasToBlob(canvas, quality), size = { w: canvas.width, h: canvas.height }; canvas.width = canvas.height = 0;
    return { blob, ...size };
  }

  /* ───────── دمج صور JPEG في ملف PDF واحد دون أي مكتبة ───────── */
  async function imagesToPdf(pages) {
    const enc = new TextEncoder(), parts = [], offsets = []; let pos = 0;
    const push = chunk => { const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk; parts.push(bytes); pos += bytes.length; };
    const n = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    push('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    offsets[1] = pos; push('1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n');
    offsets[2] = pos; push(`2 0 obj\n<</Type/Pages/Kids[${kids}]/Count ${n}>>\nendobj\n`);
    for (let i = 0; i < n; i++) {
      const { w, h, blob } = pages[i], bytes = new Uint8Array(await blob.arrayBuffer()), W = 595, H = Math.max(100, Math.round(595 * h / w)), page = 3 + i * 3, content = page + 1, image = page + 2, stream = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
      offsets[page] = pos; push(`${page} 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Resources<</XObject<</Im0 ${image} 0 R>>>>/Contents ${content} 0 R>>\nendobj\n`);
      offsets[content] = pos; push(`${content} 0 obj\n<</Length ${stream.length}>>\nstream\n${stream}\nendstream\nendobj\n`);
      offsets[image] = pos; push(`${image} 0 obj\n<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${bytes.length}>>\nstream\n`); push(bytes); push('\nendstream\nendobj\n');
    }
    const xref = pos, count = 3 + n * 3;
    push(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let i = 1; i < count; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
    push(`trailer\n<</Size ${count}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  /* ───────── القراءة ───────── */
  async function serverExtract(file) {
    const response = await fetch('/api/contributions/extract', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) }, body: file });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'تعذر استخراج النص من الملف.');
    return String(data.text || '');
  }
  function pageTextFromContent(content) {
    let out = '', lastY = null;
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5], height = item.height || 10;
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > height * 0.6 && !out.endsWith('\n')) out += '\n';
      else if (out && !out.endsWith('\n') && !out.endsWith(' ') && !item.str.startsWith(' ')) out += ' ';
      out += item.str; if (item.hasEOL) out += '\n';
      if (y !== undefined) lastY = y;
    }
    return tidy(out);
  }

  async function createOcr(lang, onProgress) {
    const module = await loadTesseract(), tesseract = module.default || module;
    const worker = await withTimeout(tesseract.createWorker(lang, 1, { logger: m => { if (m.status === 'recognizing text') onProgress?.(m.progress || 0); } }), 180000, 'تعذر تحميل بيانات اللغة للتعرف الضوئي؛ تحققوا من الاتصال بالإنترنت ثم أعيدوا المحاولة.');
    return { recognize: async canvas => String((await worker.recognize(enhanceForOcr(canvas))).data.text || '').trim(), stop: () => worker.terminate().catch(() => {}) };
  }

  /** يقرأ ملفات متعددة ويعيد { text, pages, methods, notes }؛ onProgress(نسبة 0..1، رسالة). */
  async function read(files, { lang = 'ara+fra', maxPages = 60, onProgress = () => {}, signal } = {}) {
    const list = Array.from(files || []);
    if (!list.length) throw new Error('اختاروا ملفًا أو التقطوا صورة أولًا.');
    const notes = [], methods = new Set(), chunks = []; let pages = 0, ocr = null;
    const ensureOcr = async () => ocr || (ocr = await createOcr(lang, ratio => onProgress(null, `التعرف الضوئي: ${Math.round(ratio * 100)}٪ من الصفحة الحالية…`)));
    const failures = [];
    try {
      for (let index = 0; index < list.length; index++) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        const file = list[index], slot = value => (index + value) / list.length;
        try {
        if (isServerText(file)) {
          onProgress(slot(0.3), `استخراج النص من ${file.name}…`); const text = tidy(await serverExtract(file)); if (text) { chunks.push(text); methods.add('server'); pages += 1; } onProgress(slot(1), ''); continue;
        }
        if (isImage(file)) {
          onProgress(slot(0.2), `قراءة الصورة ${file.name}…`); const bitmap = await toBitmap(file), canvas = drawScaled(bitmap, 3000); bitmap.close?.();
          const text = tidy(await (await ensureOcr()).recognize(canvas)); canvas.width = canvas.height = 0; if (text) { chunks.push(text); methods.add('ocr'); } pages += 1; onProgress(slot(1), ''); continue;
        }
        if (isPdf(file)) {
          const pdfjs = await loadPdfjs(), pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, total = pdf.numPages, count = Math.min(total, maxPages);
          if (total > count) notes.push(`قُرئت أول ${count} صفحة من ${total} في «${file.name}»؛ قسّموا الملف لقراءة البقية.`);
          for (let number = 1; number <= count; number++) {
            if (signal?.aborted) { await pdf.destroy(); throw new DOMException('aborted', 'AbortError'); }
            onProgress(slot(number / count), `${file.name} — الصفحة ${number} من ${count}`);
            const page = await pdf.getPage(number); let text = pageTextFromContent(await page.getTextContent()), method = 'pdf-text';
            if (text.length < 30 || !textQuality(text).ok) {
              const viewport = page.getViewport({ scale: 2 }), canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
              const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true }); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
              await page.render({ canvasContext: context, viewport }).promise; text = tidy(await (await ensureOcr()).recognize(canvas)); method = 'ocr'; canvas.width = canvas.height = 0;
            }
            methods.add(method); if (text) chunks.push(text); pages += 1; page.cleanup();
          }
          await pdf.destroy(); continue;
        }
        throw new Error(`نوع الملف غير مدعوم للقراءة: ${file.name}`);
        } catch (error) { if (error?.name === 'AbortError') throw error; failures.push(error); notes.push(`تعذرت قراءة «${file.name}»: ${error.message}`); }
      }
    } finally { await ocr?.stop(); }
    const text = chunks.join('\n\n').trim();
    const quality = textQuality(text);
    if (text.length < 40 && failures.length === list.length) throw failures[0];
    if (text.length < 40) throw new Error('لم يُستخرج نص كافٍ. جرّبوا صورة أوضح (300 نقطة، مستقيمة، دون ظل) أو ألصقوا النص يدويًا.');
    if (!quality.ok) notes.push('جودة القراءة منخفضة؛ راجعوا النص كاملًا وصححوه قبل الإرسال.');
    return { text, pages, methods: [...methods], notes, quality };
  }

  /* ───────── مجلد الماسح الضوئي (Chrome وEdge على الحاسوب) ───────── */
  const idb = () => new Promise((resolve, reject) => { const request = indexedDB.open('qalam-contrib', 1); request.onupgradeneeded = () => request.result.createObjectStore('kv'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const kv = {
    async get(key) { try { const db = await idb(); return await new Promise(resolve => { const request = db.transaction('kv').objectStore('kv').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(undefined); }); } catch { return undefined; } },
    async set(key, value) { try { const db = await idb(); await new Promise(resolve => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, key); tx.oncomplete = tx.onerror = tx.onabort = () => resolve(); }); return true; } catch { return false; } },
    async del(key) { try { const db = await idb(); await new Promise(resolve => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete = tx.onerror = tx.onabort = () => resolve(); }); } catch { /* لا شيء */ } },
  };
  const folder = {
    supported: typeof window.showDirectoryPicker === 'function',
    async saved() { return (await kv.get('scanner-folder')) || null; },
    async pick() { const handle = await window.showDirectoryPicker({ id: 'qalam-scanner', mode: 'read' }); await kv.set('scanner-folder', handle); await kv.set('scanner-since', Date.now()); return handle; },
    async forget() { await kv.del('scanner-folder'); await kv.del('scanner-since'); },
    async permit(handle, ask) { if (!handle?.queryPermission) return false; if ((await handle.queryPermission({ mode: 'read' })) === 'granted') return true; return ask && (await handle.requestPermission({ mode: 'read' })) === 'granted'; },
    /** ملفات PDF/صور أحدث من آخر استيراد، الأقدم أولًا. */
    async fresh(handle) {
      const since = Number(await kv.get('scanner-since')) || 0, found = [];
      for await (const entry of handle.values()) { if (entry.kind !== 'file' || !/\.(pdf|jpe?g|png)$/i.test(entry.name)) continue; const file = await entry.getFile(); if (file.lastModified > since && file.size > 0) found.push(file); }
      return found.sort((a, b) => a.lastModified - b.lastModified);
    },
    async markImported(files) { const newest = Math.max(0, ...files.map(f => f.lastModified)); if (newest) await kv.set('scanner-since', newest); },
  };

  window.QalamReader = { read, textQuality, compressImage, imagesToPdf, folder, isPdf, isImage, isServerText };
})();
