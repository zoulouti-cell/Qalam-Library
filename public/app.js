'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const fmt = n => new Intl.NumberFormat('ar-MA').format(Number(n) || 0);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalize = value => String(value ?? '').normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/[ىی]/g, 'ي').replace(/ک/g, 'ك').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).toLowerCase();
  const typeNames = { national: 'تشريع', judicial: 'اجتهاد ودراسة', juriscassation: 'قرار محكمة النقض' };
  const instrumentNames = { law: 'قانون', dahir: 'ظهير', decree: 'مرسوم', order: 'قرار تنظيمي', other: 'وثيقة', decision: 'قرار قضائي', jurisprudence: 'اجتهاد قضائي', study: 'دراسة' };
  const kindNames = { extracted_text: 'نص مستخرج', source_summary: 'ملخص المصدر', image_only: 'بطاقة دون نص' };
  const kindClasses = { extracted_text: 'text', source_summary: 'summary', image_only: 'catalog' };
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem('qalam.' + key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem('qalam.' + key, JSON.stringify(value)); return true; } catch { toast('تعذّر الحفظ المحلي. تحقق من مساحة التخزين وإعدادات المتصفح.'); return false; } }
  };
  const storedPreferences = store.get('preferences', {});
  const resetUnconsentedQueryHistory = !Object.hasOwn(storedPreferences, 'searchHistory');
  const prefs = { personalize: false, searchHistory: false, dictationEngine: 'local', readingEngine: 'browser', allowNetworkVoices: false, voice: '', rate: '1', font: 19, spellReferences: false, ...storedPreferences };
  const state = {
    view: 'library', type: 'all', scope: 'all', category: '', topic: '', scopeTouched: false, activeQueryId: 'query', page: 1, limit: 20, total: 0, browseGroup: '', expandedCard: '', previewCache: new Map(),
    categories: [], results: [], saved: store.get('saved', {}), notes: store.get('notes', {}), history: store.get('history', []), queries: resetUnconsentedQueryHistory ? [] : store.get('queries', []),
    capabilities: { ai: { available: false }, speech: { piperAvailable: false, sttAvailable: false } },
    document: null, documentId: '', askDocument: null, chat: [], suggestions: [], selectedSuggestion: -1,
    searchSequence: 0, searchAbort: null, suggestAbort: null, documentAbort: null, searchTimer: null, suggestTimer: null,
    toastTimer: null, marks: [], markIndex: -1, reading: false, paused: false, readingToken: 0, audio: null, audioURL: null,
    mic: null, micTimer: null, recording: false, voices: [], busyAsk: false,
    ingestionTimer: null, ingestionChecking: false, lastPublished: null, editorialBase: null, editorialPreview: null, editorialOcr: null, editorialOcr2: null, secondaryOcrTimer: null, ocrSettingsTimer: null, ocrSettingsChecking: false
  };
  const ocrPrefs = { workers: 2, maxPages: 0, ...store.get('ocrSettings', {}) };
  if (resetUnconsentedQueryHistory) store.set('queries', []);

  function toast(message) {
    const openDialogs = [...document.querySelectorAll('dialog[open]')];
    (openDialogs.at(-1) || document.body).append($('toast'));
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5200);
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...(options.body instanceof Blob || options.body instanceof ArrayBuffer ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
    let data;
    try { data = await response.json(); } catch { throw new Error('تعذّر قراءة استجابة الخدمة.'); }
    if (!response.ok) throw new Error(data.error || data.message || 'تعذّر إتمام الطلب حالياً.');
    return data;
  }
  function formatDate(value) {
    if (!value) return '';
    const raw = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const date = new Date(raw + 'T12:00:00');
    return Number.isNaN(date.valueOf()) ? raw : new Intl.DateTimeFormat('ar-MA', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }
  function sizeLabel(bytes) {
    return Number(bytes) >= 1048576 ? (Number(bytes) / 1048576).toFixed(1) + ' MB' : Math.round(Number(bytes) / 1024) + ' KB';
  }
  function applyStats(stats) {
    $('statDocuments').textContent = fmt(stats.documents); $('statTexts').textContent = fmt(stats.texts); $('statSummaries').textContent = fmt(stats.summaries); $('libraryCount').textContent = fmt(stats.documents); $('storageSize').textContent = sizeLabel(stats.dbBytes);
  }
  async function refreshStats() {
    try { applyStats(await api('/api/stats', { signal: AbortSignal.timeout(8000) })); } catch {}
  }
  function remainingLabel(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const minutes = Math.ceil(seconds / 60);
    return 'تقدير المتبقي: ' + (minutes < 60 ? fmt(minutes) + ' دقيقة' : fmt(Math.floor(minutes / 60)) + ' ساعة و' + fmt(minutes % 60) + ' دقيقة');
  }
  async function refreshOCRSettings(schedule=true) {
    clearTimeout(state.ocrSettingsTimer);if(state.ocrSettingsChecking)return;state.ocrSettingsChecking=true;
    try{
      const d=await api('/api/editorial/ocr/worker',{signal:AbortSignal.timeout(8000)}),p=d.progress||{},done=Number(p.completedPages)||0,total=Number(p.totalPages)||0,percent=total?Math.max(0,Math.min(100,done*100/total)):0,active=d.running||d.workersActive;
      $('ocrPagesDone').textContent=fmt(d.ocrPages);$('ocrConfidence').textContent=d.meanConfidence==null?'—':Number(d.meanConfidence).toFixed(1)+'%';$('ocrReviewWords').textContent=fmt(d.lowConfidenceWords);$('ocrSettingsProgressBar').style.width=percent.toFixed(1)+'%';$('ocrSettingsProgress').setAttribute('aria-valuenow',String(Math.round(percent)));
      const badge=$('ocrWorkerState');badge.classList.toggle('is-running',!!active||!!d.pauseRequested);badge.textContent=d.pauseRequested?(p.running?'جارٍ إيقاف الصفحات الحالية':'متوقف مؤقتاً'):active?'قيد المعالجة':d.launchError?'تعذر التشغيل':p.status==='stalled'?'متوقف — لا تحديث منذ 5 دقائق':p.status==='complete'?'اكتملت الدفعة':p.status==='not_scheduled'?'لم تبدأ المعالجة':'متوقف';
      $('ocrWorkerDetail').textContent=total?fmt(done)+' من '+fmt(total)+' صفحة · '+fmt(p.completedDocuments)+' وثيقة اكتملت · '+fmt(p.errors)+' حالات تعثر · '+fmt(d.reviewRegions)+' موضعاً معلماً للمراجعة'+(p.stale?' · يبدو أن العامل توقف؛ يمكنك استئنافه من هنا.':'')+(p.estimatedRemainingSeconds&&!p.stale?' · '+remainingLabel(p.estimatedRemainingSeconds):''):d.launchError?'تعذر تشغيل Python: '+d.launchError:'لا توجد دفعة معالجة نشطة. عدد الصفحات المحفوظة في OCR المحلي: '+fmt(d.ocrPages)+'.';
      $('ocrStartBtn').disabled=!!active&&!d.pauseRequested;$('ocrStartBtn').textContent=d.pauseRequested?'استئناف المعالجة':active?'المعالجة جارية':'بدء المعالجة أو استئنافها';$('ocrPauseBtn').disabled=!active||!!d.pauseRequested;
      if(schedule&&$('settings').open)state.ocrSettingsTimer=setTimeout(()=>refreshOCRSettings(true),active||d.pauseRequested?4000:20000);
    }catch(error){$('ocrWorkerState').textContent='تعذر جلب الحالة';$('ocrWorkerDetail').textContent=error.message;}
    finally{state.ocrSettingsChecking=false;}
  }
  async function controlOCR(action){
    const workers=Number($('ocrWorkers').value)||2,maxPages=Math.max(0,Math.min(10000,Number($('ocrMaxPages').value)||0));$('ocrStartBtn').disabled=true;$('ocrPauseBtn').disabled=true;$('ocrWorkerDetail').textContent=action==='pause'?'جارٍ طلب الإيقاف المؤقت…':'جارٍ تشغيل أداة OCR المحلية…';
    try{await api('/api/editorial/ocr/worker',{method:'POST',body:JSON.stringify({action,workers,maxPages})});if(action!=='pause')toast('بدأت معالجة OCR محلياً. يمكنك مواصلة استخدام المكتبة.');await refreshOCRSettings();}
    catch(error){$('ocrWorkerDetail').textContent=error.message;$('ocrStartBtn').disabled=false;$('ocrPauseBtn').disabled=false;}
  }
  async function pollIngestion() {
    clearTimeout(state.ingestionTimer);
    if (state.ingestionChecking) return;
    state.ingestionChecking = true;
    let nextPoll = 60000;
    try {
      const progress = await api('/api/ingestion', { signal: AbortSignal.timeout(8000) });
      if (progress.status === 'not_scheduled') { $('ingestionStatus').hidden = true; return; }
      $('ingestionStatus').hidden = false;
      const running = progress.running === true;
      const done = Number(progress.completedPages) || 0, total = Number(progress.totalPages) || 0;
      const published = Number(progress.publishedDocuments) || 0;
      const percent = total > 0 ? Math.max(0, Math.min(100, done * 100 / total)) : 0;
      $('ingestionTitle').textContent = progress.status === 'paused_for_assistant' ? 'أولوية مؤقتة لإجابة المساعد — ثم تستأنف القراءة' : running ? 'تحويل الأصول إلى نصوص — جارٍ العمل' : progress.status==='stalled'?'توقفت معالجة النصوص؛ يمكن استئنافها من إعدادات OCR' : ['completed', 'complete', 'finished'].includes(progress.status) ? 'اكتملت دفعة استخراج النصوص' : progress.status === 'failed' ? 'تحتاج عملية الاستخراج إلى متابعة' : 'حالة استخراج النصوص';
      $('ingestionTime').textContent = running ? remainingLabel(progress.estimatedRemainingSeconds) : '';
      $('ingestionBar').style.width = percent.toFixed(2) + '%';
      $('ingestionProgress').setAttribute('aria-valuenow', String(Math.round(percent)));
      $('ingestionProgress').setAttribute('aria-valuetext', fmt(done) + ' من ' + fmt(total) + ' صفحة');
      $('ingestionDetail').textContent = fmt(done) + ' من ' + fmt(total) + ' صفحة · ' + fmt(progress.completedDocuments) + ' وثيقة عولجت · ' + fmt(published) + ' نص جديد متاح' + (Number(progress.errors) > 0 ? ' · ' + fmt(progress.errors) + ' حالة تحتاج متابعة' : '');
      if (state.lastPublished !== null && published > state.lastPublished) {
        refreshStats();
        if (state.view === 'library' && !$('reader').open && !$('assistant').open && document.activeElement !== $('query')) runSearch();
      }
      state.lastPublished = published;
      nextPoll = running ? 15000 : 60000;
    } catch { /* Background progress must not interrupt search or reading. */ }
    finally {
      state.ingestionChecking = false;
      state.ingestionTimer = setTimeout(() => { if (!document.hidden) pollIngestion(); else state.ingestionTimer = setTimeout(pollIngestion, nextPoll); }, nextPoll);
    }
  }
  function isOcrDraft(doc) {
    if (isAssistantCompared(doc)) return false;
    return (doc.issues || []).some(issue => ['ocr_unverified', 'ocr_sensitive_tokens_require_review'].includes(issue)) || doc.readingAssessment?.requiresEditorialReview === true;
  }
  function isAssistantCompared(doc) {
    return doc.reviewStatus === 'source_compared' && (doc.readingAssessment?.sourceComparedBy === 'assistant' || (doc.issues || []).includes('assistant_visual_source_comparison'));
  }
  function isShortJudicialCard(doc) {
    return (doc.type === 'juriscassation' || (doc.type === 'judicial' && doc.kind !== 'study')) && doc.textKind !== 'extracted_text';
  }
  function contentLabel(doc) {
    return isShortJudicialCard(doc) ? 'بطاقة قضائية مختصرة' : kindNames[doc.textKind] || 'محتوى مفهرس';
  }
  function metadata(doc) {
    return { id: doc.id, title: doc.title, type: doc.type, kind: doc.kind || '', category: doc.category, subcategory: doc.subcategory || '', date: doc.date || '', textKind: doc.textKind, reviewStatus: doc.reviewStatus, issues: doc.issues || [], abrogated: !!doc.abrogated, snippet: doc.snippet || '', lawNumber: doc.lawNumber || '', decisionNumber: doc.decisionNumber || '' };
  }
  function foldWithOffsets(value) { let folded = '', map = []; let offset = 0; for (const char of String(value || '')) { const start = offset, end = start + char.length; offset = end; const part = normalize(char); for (const c of part) { folded += c; map.push({ start, end }); } } return { folded, map }; }
  function markText(text, query) {
    const value = String(text || ''), terms = [...new Set((normalize(query).match(/[\p{L}\p{N}]+/gu) || []).flatMap(t => [t, t.replace(/^ال(?=.{3,})/, '')]))].filter(t => t.length > 1).slice(0, 12);
    if (!terms.length) return esc(value);
    const { folded, map } = foldWithOffsets(value), ranges = [];
    for (const term of terms) { let at = 0, index; while ((index = folded.indexOf(term, at)) >= 0) { const first = map[index], last = map[index + term.length - 1]; if (first && last) ranges.push([first.start, last.end]); at = index + Math.max(1, term.length); } }
    ranges.sort((a,b) => a[0]-b[0] || b[1]-a[1]); const merged = []; for (const range of ranges) { const prev = merged.at(-1); if (prev && range[0] <= prev[1]) prev[1] = Math.max(prev[1], range[1]); else merged.push([...range]); }
    let html = '', pos = 0; for (const [start,end] of merged) { html += esc(value.slice(pos,start)) + '<mark>' + esc(value.slice(start,end)) + '</mark>'; pos = end; } return html + esc(value.slice(pos));
  }
  function skeletons() { return Array.from({ length: 4 }, () => '<div class="skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div>').join(''); }
  function emptyState(title, description, action) {
    return '<div class="empty-state"><span class="empty-icon" aria-hidden="true">⌕</span><h3>' + esc(title) + '</h3><p>' + esc(description) + '</p>' + (action ? '<button class="secondary-button" data-action="' + esc(action.key) + '">' + esc(action.label) + '</button>' : '') + '</div>';
  }

  function setView(view) {
    state.view = view; state.page = 1;
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $('filterBar').hidden = view !== 'library'; $('overview').hidden = view !== 'library';
    $('clearHistory').hidden = view !== 'history' || !state.history.length;
    $('pageTitle').innerHTML = view === 'saved' ? 'المحفوظات.<br><em>مراجع تعود إليها.</em>' : view === 'history' ? 'سجل القراءة.<br><em>مسارك داخل المكتبة.</em>' : 'اعثر على النص.<br><em>وابنِ بحثك على مصدر واضح.</em>';
    $('pageDescription').textContent = view === 'saved' ? 'وثائقك المحفوظة وملاحظاتك الخاصة على هذا الجهاز.' : view === 'history' ? 'حفظ السجل اختياري، ولا يغادر هذا المتصفح.' : 'مساحة موحّدة للبحث والقراءة في القانون المغربي، مع بيان حالة كل نص.';
    closeSidebar(); runSearch();
  }
  function categoryLabel() { return state.topic || state.category || (state.view === 'saved' ? 'المحفوظات' : state.view === 'history' ? 'سجل القراءة' : 'جميع المجالات'); }
  function renderCategories(filter = '') {
    const needle = normalize(filter);
    const categories = state.categories.filter(c => normalize(c.name).includes(needle));
    let group = '', tier = '';
    $('categoryList').innerHTML = categories.length ? categories.map(c => {
      let heading = '';
      if (c.group && c.group !== group) { group = c.group; tier = ''; heading += '<h3 class="category-group">' + esc(c.groupLabel) + '</h3>'; }
      if (c.tier && c.tier !== tier) { tier = c.tier; heading += '<h4 class="category-tier">' + esc(c.tier) + '</h4>'; }
      const count = state.scope === 'legislation' ? c.legislationCount : state.scope === 'jurisprudence' ? c.jurisprudenceCount : state.scope === 'studies' ? c.studiesCount : c.count;
      return heading + '<button class="category-button' + (state.category === c.name ? ' selected' : '') + '" data-category="' + esc(c.name) + '" aria-pressed="' + (state.category === c.name) + '"><span>' + esc(c.name) + '</span><b>' + fmt(count || 0) + '</b></button>';
    }).join('') : '<div class="sidebar-loading">لا مجال مطابق.</div>';
  }
  function renderBrowseGroup(group) {
    state.browseGroup = state.browseGroup === group ? '' : group;
    document.querySelectorAll('[data-browse-group]').forEach(b => { const active = b.dataset.browseGroup === state.browseGroup; b.setAttribute('aria-pressed', String(active)); b.classList.toggle('active', active); });
    const pane = $('browseContent'); pane.hidden = !state.browseGroup;
    if (!state.browseGroup) { pane.innerHTML = ''; $('browseGroups').hidden = false; return; }
    $('browseGroups').hidden = true;
    const groups = {materials:['materials'],judicial:['judicial'],institutions:['authorities','councils','org'],studies:['studies']};
    const rows = state.categories.filter(c => groups[state.browseGroup].includes(c.group));
    pane.innerHTML = '<button type="button" class="browse-back" data-browse-back>← الأقسام</button>' + (rows.length ? rows.map(c => '<button type="button" class="browse-leaf-button" data-category="' + esc(c.name) + '">' + esc(c.name) + '<span>' + fmt(c.count) + ' ←</span></button>').join('') : '<p class="sidebar-loading">لا تتوفر عناصر مفهرسة في هذا القسم.</p>');
  }
  function updateSavedCount() { $('savedCount').textContent = fmt(Object.keys(state.saved).length); }
  function toggleSaved(id, doc) {
    if (state.saved[id]) { delete state.saved[id]; toast('أزيلت الوثيقة من المحفوظات.'); }
    else { const found = doc || state.results.find(d => d.id === id) || state.history.find(d => d.id === id); if (!found) return; state.saved[id] = { ...metadata(found), savedAt: Date.now() }; toast('حُفظت الوثيقة على هذا الجهاز.'); }
    store.set('saved', state.saved); updateSavedCount();
    document.querySelectorAll('[data-save]').forEach(button => {
      const saved = !!state.saved[button.dataset.save]; button.classList.toggle('saved', saved); button.textContent = saved ? '◆' : '◇'; button.setAttribute('aria-pressed', String(saved)); button.setAttribute('aria-label', saved ? 'إزالة من المحفوظات' : 'حفظ الوثيقة');
    });
    if (state.document?.id === id) updateReaderBookmark();
    if (state.view === 'saved') renderLocalView();
  }
  function renderCard(doc) {
    const saved = !!state.saved[doc.id];
    const kind = doc.textKind || 'extracted_text';
    const kindLabel = isAssistantCompared(doc) ? 'قورن بالأصل بواسطة المساعد' : isOcrDraft(doc) ? 'مسودة استخراج' : contentLabel(doc);
    const note = state.view === 'saved' && state.notes[doc.id] ? '<div class="saved-note-preview">ملاحظتي: ' + esc(state.notes[doc.id].slice(0, 180)) + '</div>' : '';
    const previewOpen = state.expandedCard === doc.id;
    const preview = state.previewCache.get(doc.id);
    return '<article class="result-card ' + (previewOpen ? 'expanded ' : '') + esc((doc.type || '') + ' kind-' + (doc.kind || '')) + '"><div class="result-card-head"><span class="document-type ' + esc(doc.type) + '">' + esc(instrumentNames[doc.kind] || typeNames[doc.type] || 'وثيقة') + '</span><span class="status-badge ' + esc(isAssistantCompared(doc) ? 'compared' : isOcrDraft(doc) ? 'summary' : kindClasses[kind] || '') + '">' + esc(kindLabel) + '</span>' + (doc.abrogated ? '<span class="status-badge abrogated">منسوخ بحسب البيانات</span>' : '') + '<button class="card-save' + (saved ? ' saved' : '') + '" data-save="' + esc(doc.id) + '" aria-pressed="' + saved + '" aria-label="' + (saved ? 'إزالة من المحفوظات' : 'حفظ الوثيقة') + '" title="' + (saved ? 'إزالة من المحفوظات' : 'حفظ الوثيقة') + '">' + (saved ? '◆' : '◇') + '</button></div><button class="result-open" data-open="' + esc(doc.id) + '" title="' + esc(doc.title || '') + '">' + markText(doc.title || 'وثيقة دون عنوان', $('query').value) + '</button><p class="result-snippet">' + markText(doc.snippet || (kind === 'image_only' ? 'بيانات فهرسة فقط؛ لم يُستخرج نص هذه الوثيقة بعد.' : 'افتح الوثيقة لقراءة المحتوى المتاح وحالة مراجعته.'), $('query').value) + '</p><button type="button" class="card-expand" data-expand-doc="' + esc(doc.id) + '" aria-expanded="' + previewOpen + '">' + (previewOpen ? 'إخفاء القراءة' : 'قراءة مقتطف') + ' <span aria-hidden="true">' + (previewOpen ? '⌃' : '⌄') + '</span></button><div class="card-preview" ' + (previewOpen ? '' : 'hidden') + '>' + (preview ? '<p>' + esc(preview.slice(0,2200)) + (preview.length>2200?'…':'') + '</p><button class="secondary-button" data-open="' + esc(doc.id) + '">فتح النص كاملاً</button>' : 'جارٍ تحميل النص…') + '</div>' + note + '<div class="result-card-foot"><span class="category-tag">' + esc(doc.category || 'غير مصنف') + '</span>' + (doc.date ? '<time datetime="' + esc(doc.date) + '">' + esc(formatDate(doc.date)) + '</time>' : '<time>التاريخ غير موثق</time>') + '<span class="read-arrow" aria-hidden="true">←</span></div></article>';
  }
  function renderPagination() {
    const pages = Math.ceil(state.total / state.limit);
    $('pagination').hidden = pages <= 1;
    if (pages <= 1) return;
    const first = Math.max(1, Math.min(state.page - 2, pages - 4));
    const numbers = Array.from({ length: Math.min(5, pages) }, (_, i) => first + i);
    $('pagination').innerHTML = '<button class="page-direction" data-page="' + (state.page - 1) + '"' + (state.page === 1 ? ' disabled' : '') + '>السابق</button>' + numbers.map(p => '<button data-page="' + p + '" class="' + (p === state.page ? 'current' : '') + '"' + (p === state.page ? ' aria-current="page"' : '') + '>' + fmt(p) + '</button>').join('') + '<span class="page-summary">من ' + fmt(pages) + '</span><button class="page-direction" data-page="' + (state.page + 1) + '"' + (state.page === pages ? ' disabled' : '') + '>التالي</button>';
  }
  function updateFilterState() {
    $('breadcrumbCurrent').textContent = categoryLabel();
    const selection = state.topic || state.category;
    $('activeCategory').hidden = !selection || state.view !== 'library';
    $('activeCategory').innerHTML = selection ? '<span>مجال البحث: ' + esc(selection) + (state.topic && state.scope !== 'all' ? ' · ' + esc(state.scope === 'studies' ? 'الدراسات' : state.scope === 'jurisprudence' ? 'الاجتهادات' : 'الكل') : '') + '</span><button aria-label="إلغاء تخصيص المجال" data-clear-category>×</button>' : '';
    $('queryBottom').placeholder = selection ? 'ابحث داخل ' + selection + '…' : 'تابع البحث السريع هنا…';
    $('clearTopQuery').hidden = !$('query').value.trim(); $('clearBottomQuery').hidden = !$('queryBottom').value.trim();
    $('clearFilters').hidden = state.view !== 'library' || !($('query').value.trim() || selection || state.scope !== 'all' || $('qualityFilter').value !== 'all' || $('dateFrom').value || $('dateTo').value);
  }
  function renderLocalView() {
    const needle = normalize($('query').value.trim());
    const list = state.view === 'saved' ? Object.values(state.saved).sort((a, b) => b.savedAt - a.savedAt) : state.history;
    state.results = list.filter(d => !needle || normalize(d.title + ' ' + d.category + ' ' + (state.notes[d.id] || '')).includes(needle));
    state.total = state.results.length;
    $('resultsTitle').textContent = state.view === 'saved' ? 'وثائقك المحفوظة' : 'قراءاتك الأخيرة';
    $('resultsMeta').textContent = fmt(state.total) + ' وثيقة · محفوظ على هذا الجهاز فقط';
    $('pagination').hidden = true; $('queryCorrections').hidden = true; $('results').setAttribute('aria-busy', 'false');
    $('clearHistory').hidden = state.view !== 'history' || !state.history.length;
    $('results').innerHTML = state.results.length ? state.results.map(renderCard).join('') : state.view === 'saved' ? emptyState('ابدأ بمراجعك المهمة', 'اضغط رمز الحفظ بجوار أي وثيقة لتجدها هنا، وتعود إلى ملاحظاتك عليها.', { key: 'library', label: 'استكشف المكتبة' }) : emptyState('سجل القراءة اختياري', prefs.personalize ? 'ستظهر هنا الوثائق التي تفتحها بعد تفعيل حفظ السجل.' : 'فعّل حفظ السجل والتخصيص المحلي من التفضيلات إذا رغبت في العودة إلى قراءاتك السابقة.', { key: 'settings', label: 'تفضيلات الخصوصية' });
    updateFilterState();
  }
  async function runSearch() {
    clearTimeout(state.searchTimer); state.searchAbort?.abort();
    const sequence = ++state.searchSequence;
    updateFilterState();
    if (state.view !== 'library') { renderLocalView(); return; }
    const controller = new AbortController(); state.searchAbort = controller;
    const params = new URLSearchParams({ q: $('query').value.trim().slice(0, 300), type: state.type, scope: state.scope, category: state.category, topic: ['jurisprudence','studies'].includes(state.scope) ? state.topic : '', quality: $('qualityFilter').value, from: $('dateFrom').value, to: $('dateTo').value, page: state.page, limit: state.limit });
    $('results').setAttribute('aria-busy', 'true');
    if (!state.results.length || !state.searchTimer) $('results').innerHTML = skeletons();
    $('resultsTitle').textContent = $('query').value.trim() ? 'نتائج البحث' : state.topic || state.category || 'استكشف المكتبة';
    $('resultsMeta').textContent = 'جارٍ البحث في المحتوى المتاح…'; $('pagination').hidden = true;
    try {
      const result = await api('/api/search?' + params, { signal: controller.signal });
      if (sequence !== state.searchSequence) return;
      state.results = result.results || []; state.total = result.total || 0; state.page = result.page || state.page;
      $('results').innerHTML = state.results.length ? state.results.map(renderCard).join('') : emptyState('لم نعثر على نتائج مطابقة', 'جرّب عبارة أقصر أو رقم القانون، أو أزل بعض المرشحات. اختلاف الصياغة وحالة النص قد يؤثران في النتائج.', { key: 'clear-filters', label: 'مسح التصفية' });
      const first = state.total ? (state.page - 1) * state.limit + 1 : 0;
      const last = Math.min(state.page * state.limit, state.total);
      $('resultsMeta').textContent = state.total ? fmt(first) + '–' + fmt(last) + ' من ' + fmt(state.total) + ' نتيجة' + (Number.isFinite(result.elapsedMs) ? ' · ' + fmt(Math.round(result.elapsedMs)) + ' مللي ثانية' : '') : 'لا توجد نتائج';
      const corrections = (result.suggestions || []).filter(s => typeof s === 'string').slice(0, 8);
      $('queryCorrections').hidden = !result.relaxed && !corrections.length;
      $('queryCorrections').innerHTML = (result.relaxed ? '<span>نتائج قريبة من عبارتك، وقد لا تجمع جميع كلماتها.</span> ' : '<span>قد يفيدك أيضاً:</span> ') + corrections.map(s => '<button data-query="' + esc(s) + '">' + esc(s) + '</button>').join('');
      renderPagination();
    } catch (error) {
      if (error.name === 'AbortError' || sequence !== state.searchSequence) return;
      state.results = []; $('results').innerHTML = emptyState('تعذّر الوصول إلى المكتبة', error.message || 'تحقق من تشغيل الخدمة المحلية ثم حاول مجدداً.', { key: 'retry', label: 'إعادة المحاولة' });
      $('resultsMeta').textContent = 'الخدمة غير متاحة حالياً';
    } finally { if (sequence === state.searchSequence) $('results').setAttribute('aria-busy', 'false'); }
  }
  function scheduleSearch() { state.page = 1; clearTimeout(state.searchTimer); state.searchTimer = setTimeout(runSearch, 190); }
  function rememberQuery(query) {
    if (!prefs.searchHistory || query.length < 2) return;
    state.queries = [query, ...state.queries.filter(q => q !== query)].slice(0, 15); store.set('queries', state.queries);
  }
  function applyQuery(query) {
    $('query').value = $('queryBottom').value = String(query || '').slice(0, 300); state.page = 1; closeSuggestions(); rememberQuery($('query').value.trim());
    if (state.view !== 'library') setView('library'); else runSearch();
  }
  function clearSearchQuery() { $('query').value = $('queryBottom').value = ''; state.page = 1; closeSuggestions(); updateFilterState(); runSearch(); $('query').focus(); }
  function clearFilters() {
    $('query').value = $('queryBottom').value = ''; state.type = 'all'; state.scope = 'all'; state.scopeTouched = false; state.topic = ''; state.category = ''; state.page = 1; $('qualityFilter').value = 'all'; $('dateFrom').value = ''; $('dateTo').value = '';
    document.querySelectorAll('[data-scope]').forEach(button => { const active = button.dataset.scope === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); renderCategories(); closeSuggestions(); runSearch();
  }
  function activeQuery() { return $(state.activeQueryId) || $('query'); }
  function closeSuggestions() { $('suggestions').hidden = true; for (const id of ['query','queryBottom']) { $(id).setAttribute('aria-expanded','false'); $(id).removeAttribute('aria-activedescendant'); } state.selectedSuggestion = -1; }
  function renderSuggestions(suggestions) {
    state.suggestions = suggestions.slice(0, 9); state.selectedSuggestion = -1;
    $('suggestions').hidden = !state.suggestions.length;
    activeQuery().setAttribute('aria-expanded', String(!!state.suggestions.length));
    const labels = { title: 'وثيقة', term: 'مصطلح', related: 'موضوع قريب', recent: 'بحث سابق محلي' };
    $('suggestions').innerHTML = state.suggestions.map((s, i) => '<button type="button" class="suggestion-button" id="suggestion-' + i + '" role="option" aria-selected="false" tabindex="-1" data-suggestion="' + i + '"><span aria-hidden="true">⌕</span><span class="suggestion-label">' + esc(s.text) + '</span><small>' + esc(labels[s.type] || 'اقتراح') + '</small></button>').join('');
  }
  async function suggest() {
    const source = activeQuery(), query = source.value.trim(); state.suggestAbort?.abort();
    if (query.length < 2 || state.view !== 'library') { closeSuggestions(); return; }
    const local = prefs.searchHistory ? state.queries.filter(q => normalize(q).includes(normalize(query))).map(text => ({ text, type: 'recent' })) : [];
    const controller = new AbortController(); state.suggestAbort = controller;
    try {
      const data = await api('/api/suggest?q=' + encodeURIComponent(query.slice(0, 150)), { signal: controller.signal });
      if (source.value.trim() !== query) return;
      const seen = new Set(); renderSuggestions([...local, ...(data.suggestions || [])].filter(s => s?.text && !seen.has(s.text) && seen.add(s.text)));
    } catch (error) { if (error.name !== 'AbortError' && local.length) renderSuggestions(local); }
  }
  function pickSuggestion(index) {
    const selected = state.suggestions[index]; if (!selected) return;
    closeSuggestions(); if (selected.id) openDocument(selected.id, activeQuery().value.trim()); else applyQuery(selected.text);
  }
  function navigateSuggestions(delta) {
    if ($('suggestions').hidden || !state.suggestions.length) return;
    state.selectedSuggestion = (state.selectedSuggestion + delta + state.suggestions.length) % state.suggestions.length;
    [...$('suggestions').children].forEach((button, i) => { button.classList.toggle('active', i === state.selectedSuggestion); button.setAttribute('aria-selected', String(i === state.selectedSuggestion)); });
    const item = $('suggestions').children[state.selectedSuggestion]; activeQuery().setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' });
  }

  function updateReaderBookmark() {
    const saved = !!state.saved[state.document?.id]; $('readerBookmark').textContent = saved ? '◆' : '◇'; $('readerBookmark').setAttribute('aria-pressed', String(saved)); $('readerBookmark').setAttribute('aria-label', saved ? 'إزالة الوثيقة من المحفوظات' : 'حفظ الوثيقة');
  }
  function recordReading(doc) {
    if (!prefs.personalize) return;
    state.history = [{ ...metadata(doc), seenAt: Date.now() }, ...state.history.filter(d => d.id !== doc.id)].slice(0, 100); store.set('history', state.history);
  }
  function readerNotice(doc) {
    const kind = doc.textKind || 'extracted_text';
    let note = kind === 'source_summary' ? 'المحتوى ملخص من المصدر؛ لا يمثل متن القرار الكامل.' : kind === 'image_only' ? 'بيانات فهرسة فقط. نص هذه الوثيقة غير متاح في النسخة النصية.' : 'نص مستخرج. لا يُعد اجتياز الفحص الآلي اعتماداً بشرياً شاملاً.';
    if (isShortJudicialCard(doc)) note = kind === 'source_summary' ? 'بطاقة قضائية محفوظة بملخصها أو قاعدتها المتاحة. المتن الكامل للقرار غير متاح؛ لا يُعد المعروض نص القرار الكامل.' : 'بطاقة قضائية محفوظة ببيانات فهرستها. المتن الكامل غير متاح.';
    if (isOcrDraft(doc)) note = 'مسودة نص مستخرج آلياً من الأصل. تحتاج مراجعة تحريرية للأسماء والأرقام والنفي والإحالات؛ لا تمثل اعتماداً بشرياً.';
    if (isAssistantCompared(doc)) note = 'قورن النص بصور صفحات الأصل بواسطة المساعد. هذه مقارنة من المساعد، ولا تمثل تدقيقاً أو اعتماداً بشرياً أو رسمياً.';
    if (doc.reviewStatus === 'needs_review' && kind === 'extracted_text') note += ' رُصدت مؤشرات تستدعي المراجعة.';
    if (doc.reviewStatus === 'official_source_import') note = 'نص مستورد من النشر الإلكتروني الرسمي للمحكمة الدستورية، مع التحقق من اكتمال فصوله. لا يمثل ذلك تدقيقاً بشرياً مستقلاً لكل كلمة.';
    if (doc.abrogated) note += ' مُعلّم كمنسوخ بحسب البيانات المتاحة؛ يلزم التحقق من وضعه الزمني.';
    if ((doc.issues || []).includes('source_date_conflict')) note += ' تاريخ الوثيقة مختلف بين رأس المصدر وفهرسه؛ يلزم التحقق.';
    if ((doc.issues || []).includes('reconstructed_pdf_container')) note += ' استُعيدت بنية الملف لقراءة صفحاته؛ النص قيد المراجعة.';
    const assessment = doc.readingAssessment;
    if (isAssistantCompared(doc) && Array.isArray(assessment?.sourceComparedPages)) note += ' صفحات المقارنة: ' + assessment.sourceComparedPages.map(fmt).join('، ') + '.';
    if (assessment?.pages) note += ' شمل الاستخراج ' + fmt(assessment.pages) + ' صفحة.';
    if (Number.isFinite(assessment?.lowWords)) note += ' رُصدت ' + fmt(assessment.lowWords) + ' كلمة ذات تعرف ضعيف.';
    if (Number.isFinite(assessment?.meanEngineConfidence)) note += ' مؤشر محرك التعرف لا يمثل احتمال صحة النص.';
    return '<span class="notice-plain">' + esc(note) + '</span>';
  }
  function textRun(text, query) { return query && query.length > 1 ? markText(text, query) : esc(text); }
  function renderReaderBody(needle = '') {
    const doc = state.document; if (!doc) return;
    const text = doc.text || '';
    if (!text.trim()) {
      $('readerBody').innerHTML = '<div class="document-absence"><strong>هذه بطاقة فهرسة دون نص.</strong><br>لم يُستخرج المحتوى بعد، ولا تُنشئ المكتبة نصاً بديلاً عنه.<br>يمكنك حفظ البطاقة أو تدوين ملاحظتك عليها.</div>';
      state.marks = []; return;
    }
    const headings = (doc.headings || []).filter(h => Number.isInteger(h.start) && h.start >= 0 && h.start < text.length).sort((a, b) => a.start - b.start);
    let html = '', cursor = 0;
    const paragraphs = value => String(value).split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean).map(p => '<p data-read-block>' + textRun(p, needle) + '</p>').join('');
    headings.forEach((heading, index) => {
      if (heading.start < cursor) return;
      if (heading.start > cursor) html += paragraphs(text.slice(cursor, heading.start));
      let length = String(heading.label || '').length;
      if (!length || text.slice(heading.start, heading.start + length).trim() !== String(heading.label).trim()) {
        const lineEnd = text.indexOf('\n', heading.start); length = Math.min(160, (lineEnd < 0 ? text.length : lineEnd) - heading.start);
      }
      html += '<h3 id="doc-heading-' + index + '" data-read-block>' + textRun(text.slice(heading.start, heading.start + length), needle) + '</h3>';
      cursor = heading.start + length;
    });
    if (cursor < text.length) html += paragraphs(text.slice(cursor));
    $('readerBody').innerHTML = html;
    state.marks = [...$('readerBody').querySelectorAll('mark')]; state.markIndex = -1;
    $('findControls').hidden = needle.length < 2;
    $('findCount').textContent = state.marks.length ? fmt(state.marks.length) + ' موضع' : 'لا مطابقة';
    if (state.marks.length) moveFind(1);
  }
  function moveFind(delta) {
    if (!state.marks.length) return;
    state.marks[state.markIndex]?.classList.remove('current');
    state.markIndex = (state.markIndex + delta + state.marks.length) % state.marks.length;
    const mark = state.marks[state.markIndex]; mark.classList.add('current'); mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('findCount').textContent = fmt(state.markIndex + 1) + ' من ' + fmt(state.marks.length);
  }
  function renderOutline(doc) {
    const headings = doc.headings || []; $('outlineCount').textContent = headings.length ? fmt(headings.length) : '';
    $('outline').innerHTML = headings.length ? headings.map((h, i) => '<button class="outline-item" data-heading="' + i + '">' + esc(h.label) + '</button>').join('') : '<div class="setting-note">لا يتوفر فهرس بنيوي لهذه الوثيقة.</div>';
  }
  async function openDocument(id, searchNeedle = '') {
    saveNote();
    closeSuggestions(); closeSidebar(); stopReading(); await stopMic(true); state.documentAbort?.abort(); state.documentId = id; state.document = null;
    if ($('assistant').open) $('assistant').close();
    $('readerTitle').textContent = 'جارٍ تحميل الوثيقة…'; $('readerType').textContent = ''; $('readerContentStatus').textContent = ''; $('readerMeta').textContent = ''; $('readerStatus').textContent = ''; $('readerSource').textContent = ''; $('readerBody').innerHTML = '<div class="loading-label">جارٍ تحميل النص المحفوظ…</div>'; $('outline').innerHTML = ''; $('outlineCount').textContent = ''; $('readerFind').value = searchNeedle; $('findControls').hidden = true; $('documentNote').hidden = true;
    if (!$('reader').open) $('reader').showModal();
    const controller = new AbortController(); state.documentAbort = controller;
    try {
      const doc = await api('/api/document?id=' + encodeURIComponent(id), { signal: controller.signal });
      if (state.documentId !== id || !$('reader').open) return;
      state.document = doc; $('readerTitle').textContent = doc.title || 'وثيقة دون عنوان'; $('readerType').textContent = instrumentNames[doc.kind] || typeNames[doc.type] || 'وثيقة'; $('readerType').className = 'document-type ' + (doc.type || ''); $('readerContentStatus').textContent = isAssistantCompared(doc) ? 'قورن بالأصل بواسطة المساعد' : isOcrDraft(doc) ? 'مسودة تحتاج مراجعة' : contentLabel(doc); $('readerContentStatus').className = 'status-badge ' + (isAssistantCompared(doc) ? 'compared' : isOcrDraft(doc) ? 'summary' : kindClasses[doc.textKind || 'extracted_text']);
      if (state.saved[id]) { state.saved[id] = { ...metadata(doc), savedAt: state.saved[id].savedAt }; store.set('saved', state.saved); }
      $('readerMeta').textContent = [doc.category, doc.subcategory, doc.lawNumber ? 'قانون رقم ' + doc.lawNumber : '', doc.decisionNumber ? 'قرار رقم ' + doc.decisionNumber : '', doc.caseNumber ? 'ملف ' + doc.caseNumber : '', formatDate(doc.date)].filter(Boolean).join(' · ');
      $('readerStatus').innerHTML = readerNotice(doc); $('readerBody').style.fontSize = prefs.font + 'px';
      renderReaderBody(searchNeedle); renderOutline(doc); updateReaderBookmark();
      $('readerSource').textContent = [doc.sourceLabel ? 'المصدر: ' + doc.sourceLabel : '', doc.citation || '', 'حالة المحتوى: ' + contentLabel(doc) + '.'].filter(Boolean).join('\n');
      $('noteText').value = state.notes[id] || ''; $('noteStatus').textContent = state.notes[id] ? 'ملاحظة محفوظة على هذا الجهاز' : 'الحفظ محلي على جهازك';
      if (!searchNeedle || state.marks.length === 0) $('readerScroll').scrollTop = 0; else requestAnimationFrame(() => { state.marks[0]?.scrollIntoView({behavior:'smooth',block:'center'}); updateReadingPosition(); }); updateReadingPosition(); recordReading(doc);
    } catch (error) {
      if (error.name === 'AbortError') return;
      $('readerTitle').textContent = 'تعذّر فتح الوثيقة'; $('readerBody').innerHTML = '<div class="document-absence">' + esc(error.message) + '</div>';
    }
  }
  function closeReader() { saveNote(); stopReading(); state.documentAbort?.abort(); $('reader').close(); state.documentId = ''; if (state.view !== 'library') renderLocalView(); }
  function updateReadingPosition() {
    const scroll = $('readerScroll'); const available = scroll.scrollHeight - scroll.clientHeight;
    const percent = available > 0 ? Math.min(100, Math.round(scroll.scrollTop * 100 / available)) : 100;
    $('readerPosition').textContent = state.document ? 'قراءة ' + fmt(percent) + '٪ · ' + fmt(state.document.chars || state.document.text?.length || 0) + ' حرف متاح' : 'قراءة النص المتاح';
  }
  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); return true; } catch {
      const area = document.createElement('textarea'); area.value = value; area.style.position = 'fixed'; area.style.top = '-9999px'; $('reader').append(area); area.select();
      const copied = document.execCommand('copy'); area.remove(); return copied;
    }
  }
  function exportCurrent() {
    const doc = state.document; if (!doc) return;
    const data = [doc.title, doc.citation || '', 'نوع المحتوى: ' + (isAssistantCompared(doc) ? 'قورن بالأصل بواسطة المساعد؛ لا يمثل اعتماداً بشرياً أو رسمياً' : isOcrDraft(doc) ? 'مسودة استخراج آلي تحتاج مراجعة تحريرية' : kindNames[doc.textKind]), 'النص المستخرج أو الملخص لا يعني اعتماداً بشرياً شاملاً.', '\n' + (doc.text || 'لا يتوفر نص لهذه البطاقة.')].join('\n');
    const blob = new Blob(['\ufeff', data], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = (doc.title || 'وثيقة').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) + '.txt'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function saveNote(showToast = false) {
    if (!state.document) return;
    const value = $('noteText').value.slice(0, 10000); if (value.trim()) state.notes[state.document.id] = value; else delete state.notes[state.document.id];
    if (store.set('notes', state.notes)) { $('noteStatus').textContent = 'حُفظت محلياً على هذا الجهاز'; if (showToast) toast('حُفظت ملاحظتك.'); }
  }

  function openAssistant(context = null) {
    saveNote(); stopMic(true);
    if (context) state.askDocument = metadata(context);
    if ($('reader').open) $('reader').close();
    stopReading(); renderAssistantContext();
    if (!$('assistant').open) $('assistant').showModal(); $('askInput').focus();
    $('navAssistant').classList.add('assistant-active'); $('navAssistant').setAttribute('aria-expanded', 'true');
  }
  function renderAssistantContext() {
    $('assistantContext').hidden = !state.askDocument;
    $('assistantContext').innerHTML = state.askDocument ? '<span>ضمن الوثيقة: ' + esc(state.askDocument.title) + '</span><button data-remove-context aria-label="إلغاء سياق الوثيقة">×</button>' : '';
  }
  function appendChat(role, content) {
    $('chatMessages').querySelector('.assistant-welcome')?.remove();
    const element = document.createElement('div'); element.className = 'chat-message ' + role;
    if (role === 'user') element.textContent = content; else element.innerHTML = content;
    $('chatMessages').append(element); $('chatMessages').scrollTop = $('chatMessages').scrollHeight; return element;
  }
  function answerMarkup(answer) {
    return esc(answer || 'لم تتوفر إجابة مسندة لهذا السؤال.').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  }
  function renderAssistantAnswer(element,result) {
    const modes={extractive:'استرجاع من المصادر · دون توليد بنموذج',local_model:'تحليل بمساعد محلي',remote_model:'تحليل بمساعد متصل'};
    const sources=result.sources||[];
    element.innerHTML='<span class="chat-mode">'+esc(modes[result.mode]||'مساعدة مرتبطة بالمصادر')+'</span><div class="chat-answer">'+answerMarkup(result.answer)+'</div>'+(sources.length?'<div class="chat-source-list">'+sources.map((s,i)=>'<button class="chat-source" data-source-open="'+esc(s.id)+'"><b>'+fmt(i+1)+'</b>'+esc(s.title)+'<small>'+esc(s.label||kindNames[s.textKind]||'محتوى مسترجع')+(s.excerpt?' · '+esc(s.excerpt.slice(0,160)):'')+'</small></button>').join('')+'</div>':'')+((result.limitations||[]).length?'<div class="chat-limitations">'+result.limitations.map(esc).join('<br>')+'</div>':'')+(result.analysisPending?'<div class="chat-pending"><span></span> المصادر أمامك؛ جارٍ إعداد التحليل المسند…</div>':'');
  }
  async function askQuestion() {
    const question = $('askInput').value.trim(); if (!question || state.busyAsk) return;
    if (question.length > 3000) { toast('اختصر السؤال إلى 3000 حرف.'); return; }
    await stopMic(true); state.busyAsk = true; $('askSubmit').disabled = true; appendChat('user', question); $('askInput').value = '';
    const pending = appendChat('assistant', '<div class="chat-pending"><span></span> جارٍ البحث في النصوص وإعداد المساعدة…</div>');
    try {
      let result = await api('/api/ask', { method: 'POST', body: JSON.stringify({ question, history: state.chat.slice(-6), ...(state.askDocument ? { documentId: state.askDocument.id } : {}) }), signal: AbortSignal.timeout(15000) });
      renderAssistantAnswer(pending,result);
      if(result.analysisPending&&result.jobId){
        const until=Date.now()+125000;let finished=false;
        while(Date.now()<until){
          await new Promise(resolve=>setTimeout(resolve,1600));
          try{const job=await api('/api/answer?id='+encodeURIComponent(result.jobId),{signal:AbortSignal.timeout(5000)});if(job.status==='complete'){result=job.result;renderAssistantAnswer(pending,result);finished=true;break;}}catch{break;}
        }
        if(!finished){result={...result,analysisPending:false,limitations:[...(result.limitations||[]),'المصادر معروضة؛ لم يصل تحليل معتمد في الوقت المتاح.']};renderAssistantAnswer(pending,result);}
      }
      state.chat.push({ role: 'user', content: question }, { role: 'assistant', content: result.answer || '' }); state.chat = state.chat.slice(-12);
    } catch (error) { pending.innerHTML = '<div class="chat-answer">' + esc(error.name === 'TimeoutError' ? 'استغرق الطلب وقتاً أطول من المتوقع. يمكنك تضييق السؤال أو العودة إلى البحث النصي.' : error.message) + '</div>'; }
    finally { state.busyAsk = false; $('askSubmit').disabled = false; $('chatMessages').scrollTop = $('chatMessages').scrollHeight; }
  }

  function persistPrefs() { store.set('preferences', prefs); }
  function populateVoices() {
    const allArabic = 'speechSynthesis' in window ? speechSynthesis.getVoices().filter(voice => /^ar(?:-|_)/i.test(voice.lang)) : [];
    state.voices = allArabic.filter(voice => voice.localService || prefs.allowNetworkVoices);
    $('voiceSelect').innerHTML = state.voices.length ? state.voices.map((voice, i) => '<option value="' + esc(voice.voiceURI || String(i)) + '">' + esc(voice.name + ' · ' + voice.lang + (voice.localService ? ' · محلي' : ' · عبر الشبكة')) + '</option>').join('') : '<option value="">لا يوجد صوت عربي متاح</option>';
    const selectedVoice = state.voices.find(v => (v.voiceURI || '') === prefs.voice);
    const firstLocal = state.voices.find(v => v.localService);
    if (selectedVoice) $('voiceSelect').value = prefs.voice;
    else if (firstLocal) { prefs.voice = firstLocal.voiceURI || ''; $('voiceSelect').value = prefs.voice; }
    else { prefs.voice = ''; $('voiceSelect').value = ''; }
    const localCount = allArabic.filter(voice => voice.localService).length;
    const networkCount = allArabic.filter(voice => !voice.localService).length;
    $('voiceAvailability').textContent = state.voices.length ? localCount + ' صوتاً محلياً متاحاً' + (prefs.allowNetworkVoices ? ' · ' + networkCount + ' صوتاً عبر الشبكة' : '') + '. أصوات المتصفح تختلف باختلاف النظام؛ لا يتوفر صوت مغربي في كل الأجهزة.' : 'لا يوجد صوت عربي محلي في المتصفح. يتوفر في هذه البيئة صوت Piper عربي محلي بجودة متوسطة.';
  }
  async function testReadingVoice(){
    const button=$('voiceTestBtn'),status=$('voiceTestStatus');button.disabled=true;status.textContent='جارٍ تجهيز عينة صوتية…';
    if(prefs.readingEngine==='local'){
      let url='';try{const response=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'هذا اختبار للصوت العربي المحلي في مكتبة قلم.'}),signal:AbortSignal.timeout(35000)});if(!response.ok){let message='تعذر توليد الصوت المحلي.';try{message=(await response.json()).error||message;}catch{}throw new Error(message);}const blob=await response.blob();if(!blob.type.includes('audio'))throw new Error('استجابة الصوت المحلي ليست ملفاً صوتياً.');url=URL.createObjectURL(blob);const audio=new Audio(url);audio.onended=()=>{URL.revokeObjectURL(url);status.textContent='يعمل صوت كريم العربي المحلي (Piper).';button.disabled=false;};audio.onerror=()=>{URL.revokeObjectURL(url);status.textContent='تولّد الصوت لكن تعذر تشغيله في المتصفح.';button.disabled=false;};await audio.play();}
      catch(error){if(url)URL.revokeObjectURL(url);status.textContent=error.message||'تعذر تشغيل الصوت المحلي.';button.disabled=false;}return;
    }
    const voice=state.voices.find(v=>v.voiceURI===prefs.voice)||state.voices.find(v=>v.localService)||state.voices[0];if(!('speechSynthesis'in window)||!voice){status.textContent='لا يتوفر صوت عربي للمتصفح. اختر Piper المحلي من طريقة القراءة.';button.disabled=false;return;}
    const utterance=new SpeechSynthesisUtterance('هذا اختبار للصوت العربي في مكتبة قلم.');utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=Number(prefs.rate)||1;utterance.onend=()=>{status.textContent='اكتمل الاختبار بواسطة '+voice.name+'.';button.disabled=false;};utterance.onerror=()=>{status.textContent='تعذر تشغيل صوت المتصفح.';button.disabled=false;};speechSynthesis.cancel();speechSynthesis.speak(utterance);
  }
  function refreshSettings() {
    $('personalize').checked = !!prefs.personalize; $('searchHistoryEnabled').checked = !!prefs.searchHistory; $('dictationEngine').value = prefs.dictationEngine; $('readingEngine').value = prefs.readingEngine; $('readRate').value = prefs.rate;
    $('allowNetworkVoices').checked = !!prefs.allowNetworkVoices; $('networkVoiceWarning').hidden = !prefs.allowNetworkVoices;
    $('browserSpeechWarning').hidden = prefs.dictationEngine !== 'browser';
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    $('dictationAvailability').textContent = prefs.dictationEngine === 'local' ? (state.capabilities.speech?.sttAvailable ? 'المحرك المحلي متاح: ' + (state.capabilities.speech.sttEngine || 'تعرف صوتي محلي') + '. لن ينتقل الإملاء إلى الشبكة تلقائياً.' : 'المحرك المحلي غير متاح حالياً. يمكنك ربطه أو اختيار خدمة المتصفح صراحة.') : Recognition ? 'يدعم هذا المتصفح خدمة التعرف الصوتي. اختيارك يجيز استخدام هذه الخدمة عند الضغط على الميكروفون.' : 'خدمة التعرف الصوتي غير مدعومة في هذا المتصفح.';
    if (prefs.readingEngine === 'local'){$('voiceSelect').innerHTML='<option value="piper-local">كريم · العربية الأردنية · Piper محلي</option>';$('voiceSelect').value='piper-local';$('voiceSelect').disabled=true;$('voiceAvailability').textContent=state.capabilities.speech?.piperAvailable?'محرك Piper المحلي جاهز. جودة الصوت متوسطة، وليس بلهجة مغربية.':'محرك القراءة المحلي غير متاح حالياً.';$('voiceTestBtn').disabled=!state.capabilities.speech?.piperAvailable;}
    else{$('voiceSelect').disabled=false;populateVoices();$('voiceTestBtn').disabled=false;}
  }
  function openSettings() { if (state.mic) stopMic(true); refreshSettings();if (!$('settings').open) $('settings').showModal();$('ocrWorkers').value=String(ocrPrefs.workers);$('ocrMaxPages').value=String(ocrPrefs.maxPages);refreshOCRSettings(); }
  function resetEditorialPreview() {
    state.editorialPreview = null; $('editorialPreview').hidden = true; $('editorialPreview').innerHTML = ''; $('editorialConfirm').checked = false; $('editorialSaveBtn').disabled = true;
  }
  function editorialSnapshot() { return JSON.stringify({ title:$('editorialTitle').value, text:$('editorialText').value, reason:$('editorialReason').value, sourceUrl:$('editorialSourceUrl').value }); }
  function updateEditorialSave() { $('editorialSaveBtn').disabled = !state.editorialBase || !state.editorialPreview || state.editorialPreview.snapshot !== editorialSnapshot() || !$('editorialConfirm').checked; }
  async function searchEditorialDocuments() {
    const q=$('editorialQuery').value.trim();if(q.length<2){$('editorialResults').hidden=true;$('editorialStatus').textContent='أدخل حرفين على الأقل للبحث عن النص.';return;}
    $('editorialStatus').textContent='جارٍ البحث في النصوص المحلية…';$('editorialResults').hidden=false;$('editorialResults').innerHTML='<p class="setting-note">جارٍ البحث…</p>';
    try{const data=await api('/api/editorial/search?q='+encodeURIComponent(q));$('editorialResults').innerHTML=data.results.length?data.results.map(d=>'<button type="button" class="editorial-result" data-editorial-id="'+esc(d.id)+'"><strong>'+esc(d.title)+'</strong><small>'+esc(d.category||'غير مصنف')+' · '+esc(kindNames[d.textKind]||'محتوى مفهرس')+' · '+fmt(d.chars)+' حرف</small></button>').join(''):'<p class="setting-note">لم أعثر على نص مطابق في الفهرس المحلي.</p>'; $('editorialStatus').textContent='';}
    catch(error){$('editorialResults').innerHTML='';$('editorialStatus').textContent=error.message;}
  }
  async function openEditorialDocument(id) {
    $('editorialStatus').textContent='جارٍ تحميل النص المحفوظ…';$('editorialEditor').hidden=true;state.editorialBase=null;resetEditorialPreview();
    try{const doc=await api('/api/editorial/document?id='+encodeURIComponent(id));if(!doc.text||doc.text.length<40){$('editorialStatus').textContent='لا يوجد نص قابل للتحرير لهذه البطاقة.';return;}state.editorialBase={id:doc.id,sha256:doc.sha256,title:doc.title,text:doc.text};state.editorialOcr=null;$('editorialTitle').value=doc.title;$('editorialText').value=doc.text;$('editorialReason').value='';$('editorialSourceUrl').value='';$('editorialConfirm').checked=false;$('editorialDocumentMeta').textContent=doc.category+' · '+(kindNames[doc.textKind]||'محتوى مفهرس')+' · '+fmt(doc.text.length)+' حرف · '+doc.reviewStatus;$('editorialEditor').hidden=false;$('editorialStatus').textContent='';await Promise.all([loadEditorialHistory(doc.id),loadEditorialOcr(doc.id)]);}
    catch(error){$('editorialStatus').textContent=error.message;}
  }
  async function loadEditorialOcr(id){
    $('editorialOcrStatus').textContent='جارٍ التحقق من قراءات OCR المحلية…';$('editorialOcrLoadBtn').hidden=true;$('editorialOcr2LoadBtn').hidden=true;$('editorialOcr2RunBtn').hidden=true;
    try{const data=await api('/api/editorial/ocr?id='+encodeURIComponent(id));state.editorialOcr=data.text?data:null;state.editorialOcr2=data.alternateText?data:null;if(!data.pages){$('editorialOcrStatus').textContent=data.status==='not_queued'?'لا توجد قراءة OCR مسجلة لهذه الوثيقة.':'OCR في الطابور؛ لم تكتمل صفحات قابلة للمقارنة بعد.';return;}const confidence=Number(data.meanEngineConfidence||0).toFixed(1);let note='Tesseract: '+fmt(data.pages)+' من '+fmt(data.totalPages)+' صفحة · متوسط درجة المحرك '+confidence+' · مناطق تحتاج مراجعة '+fmt(data.reviewRegions)+'. '+(data.complete?'النص الكامل متاح.':'القراءة جزئية.');if(data.alternatePages){note+=' PaddleOCR: '+fmt(data.alternatePages)+' صفحة · اتفاق حرفي متوسط '+Number(data.alternateAgreementPercent||0).toFixed(1)+'% · اختلافات أرقام/نفي '+fmt(data.criticalDifferences)+'.';}else note+=' لم تُشغّل المقارنة الثانية بعد.';$('editorialOcrStatus').textContent=note;$('editorialOcrLoadBtn').hidden=!data.text;$('editorialOcr2LoadBtn').hidden=!data.alternateText;$('editorialOcr2RunBtn').hidden=!!data.alternateComplete||!data.pages;$('editorialOcr2RunBtn').disabled=!data.complete;if(!data.complete)$('editorialOcr2RunBtn').title='يمكن المقارنة بعد اكتمال OCR الأساسي لهذه الوثيقة.';else $('editorialOcr2RunBtn').title='يشغّل محركاً محلياً اختيارياً على الصفحات المفهرسة للمقارنة فقط.';}
    catch{$('editorialOcrStatus').textContent='تعذر قراءة نتيجة OCR المحلية.';}
  }
  async function pollSecondaryOcr(id,repeat=true){try{const status=await api('/api/editorial/ocr/secondary/status?id='+encodeURIComponent(id));if(status.running){$('editorialOcr2RunBtn').disabled=true;$('editorialOcrStatus').textContent='المقارنة المحلية تعمل: '+fmt(status.processed||0)+' من '+fmt(status.totalPages||0)+' صفحة.';if(repeat){clearTimeout(state.secondaryOcrTimer);state.secondaryOcrTimer=setTimeout(()=>pollSecondaryOcr(id,true),2500);}return;}if(status.error){$('editorialOcrStatus').textContent=status.error;$('editorialOcr2RunBtn').disabled=false;return;}if(status.finishedAt){$('editorialOcrStatus').textContent='اكتملت المقارنة الثانية ('+fmt(status.processed||0)+' صفحة؛ أخطاء '+fmt(status.errors||0)+'). جارٍ تحديث الفروق…';await loadEditorialOcr(id);}}catch{}}
  async function startSecondaryOcr(){if(!state.editorialBase)return;const id=state.editorialBase.id;$('editorialOcr2RunBtn').disabled=true;$('editorialOcrStatus').textContent='جارٍ بدء محرك OCR العربي المحلي…';try{await api('/api/editorial/ocr/secondary/start',{method:'POST',body:JSON.stringify({id})});pollSecondaryOcr(id,true);}catch(error){$('editorialOcrStatus').textContent=error.message;$('editorialOcr2RunBtn').disabled=false;}}
  function useEditorialOcr(engine='tesseract'){const candidate=engine==='paddle'?state.editorialOcr2:state.editorialOcr;if(!candidate?.text||!state.editorialBase)return;if(!confirm('سيُحمّل نص '+(engine==='paddle'?'PaddleOCR':'Tesseract')+' مكان النص في محرر المقارنة. النص المحفوظ لن يتغير إلا بعد معاينة الفروق وتأكيد الحفظ، وقد يحتوي OCR على أخطاء. متابعة؟'))return;$('editorialText').value=engine==='paddle'?candidate.alternateText:candidate.text;$('editorialReason').value='مقارنة قراءتي Tesseract وPaddleOCR بالنص المحفوظ؛ يلزم تدقيق الفروق قبل الاعتماد.';resetEditorialPreview();$('editorialStatus').textContent='حُمّلت قراءة '+(engine==='paddle'?'PaddleOCR':'Tesseract')+' للمقارنة. راجع الفروق ولا تحفظ قبل التحقق.';$('editorialText').focus();}
  async function loadEditorialHistory(id) {
    try{const {history}=await api('/api/editorial/history?id='+encodeURIComponent(id));$('editorialHistory').hidden=!history.length;$('editorialHistory').innerHTML=history.length?'<h4>سجل التعديلات المحلية</h4>'+history.map(h=>'<article class="editorial-history-item"><div><strong>'+esc(h.created_at.slice(0,16).replace('T',' '))+'</strong><small>'+esc(h.reason)+' · '+(h.status==='applied'?'مطبق محلياً':'مسترجع')+(h.source_url?' · <a href="'+esc(h.source_url)+'" target="_blank" rel="noopener">المصدر</a>':'')+'</small></div>'+(h.status==='applied'?'<button type="button" class="text-button" data-editorial-revert="'+esc(h.id)+'">استرجاع النسخة السابقة</button>':'')+'</article>').join(''):'';}
    catch{$('editorialHistory').hidden=true;$('editorialHistory').innerHTML='';}
  }
  function previewEditorialChange() {
    if(!state.editorialBase)return;const snapshot=editorialSnapshot(),title=$('editorialTitle').value.trim(),text=$('editorialText').value.trim(),reason=$('editorialReason').value.trim();if(title.length<3||text.length<40||reason.length<8){$('editorialStatus').textContent='أكمل العنوان والنص وسبب التعديل قبل المعاينة.';return;}
    let prefix=0;const old=state.editorialBase.text;while(prefix<old.length&&prefix<text.length&&old[prefix]===text[prefix])prefix++;let suffix=0;while(suffix<old.length-prefix&&suffix<text.length-prefix&&old[old.length-1-suffix]===text[text.length-1-suffix])suffix++;const oldEnd=Math.min(old.length,prefix+240),newEnd=Math.min(text.length,prefix+240);
    $('editorialPreview').innerHTML='<div class="editorial-diff"><div><strong>قبل</strong><pre>'+esc(old.slice(Math.max(0,prefix-80),oldEnd))+'</pre></div><div><strong>بعد</strong><pre>'+esc(text.slice(Math.max(0,prefix-80),newEnd))+'</pre></div></div><p>موضع الاختلاف التقريبي: '+fmt(prefix)+' · المحذوف '+fmt(old.length-prefix-suffix)+' حرفاً · المضاف '+fmt(text.length-prefix-suffix)+' حرفاً.</p><p>العنوان: '+esc(state.editorialBase.title)+' ← '+esc(title)+'</p>';
    $('editorialPreview').hidden=false;state.editorialPreview={snapshot};$('editorialConfirm').checked=false;$('editorialStatus').textContent='راجع المقارنة، ثم أكد الحفظ المحلي.';updateEditorialSave();
  }
  async function saveEditorialCorrection() {
    if(!state.editorialBase||!state.editorialPreview||state.editorialPreview.snapshot!==editorialSnapshot()||!$('editorialConfirm').checked)return;
    $('editorialSaveBtn').disabled=true;$('editorialStatus').textContent='جارٍ حفظ النسخة ومؤشر المراجعة…';
    try{const result=await api('/api/editorial/apply',{method:'POST',body:JSON.stringify({id:state.editorialBase.id,baseSha:state.editorialBase.sha256,title:$('editorialTitle').value,text:$('editorialText').value,reason:$('editorialReason').value,sourceUrl:$('editorialSourceUrl').value})});toast('حُفظ التصحيح محلياً، ووُسم بأنه يحتاج مراجعة بشرية.');await refreshStats();await runSearch();await openEditorialDocument(result.id);}
    catch(error){$('editorialStatus').textContent=error.message;updateEditorialSave();}
  }
  async function revertEditorialCorrection(historyId) {
    if(!confirm('استرجاع النسخة السابقة؟ سيصبح النص الحالي محفوظاً ضمن سجل التعديلات.'))return;
    try{const result=await api('/api/editorial/revert',{method:'POST',body:JSON.stringify({historyId})});toast('استُرجعت النسخة السابقة.');await refreshStats();await runSearch();await openEditorialDocument(result.id);}
    catch(error){$('editorialStatus').textContent=error.message;}
  }
  function audioStatus(text, settingsLink = false) {
    $('readerAudioStatus').hidden = !text; $('readerAudioStatus').textContent = text;
    if (settingsLink) { const button = document.createElement('button'); button.textContent = 'تفضيلات الصوت'; button.addEventListener('click', openSettings); $('readerAudioStatus').append(button); }
  }
  function stopReading() {
    state.readingToken++; state.reading = false; state.paused = false;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (state.audio) { state.audio.pause(); state.audio.src = ''; state.audio = null; }
    if (state.audioURL) { URL.revokeObjectURL(state.audioURL); state.audioURL = null; }
    $('listenBtn').classList.remove('active'); $('listenBtn').textContent = '◖ استمع'; $('pauseReadBtn').disabled = true; $('pauseReadBtn').textContent = 'إيقاف مؤقت'; $('stopReadBtn').disabled = true;
    $('readerBody').querySelectorAll('.reading-current').forEach(el => el.classList.remove('reading-current'));
  }
  function readingChunks() {
    const blocks = [...$('readerBody').querySelectorAll('[data-read-block]')];
    const chunks = [];
    blocks.forEach(block => {
      let value = (block.textContent || '').replace(/\s+/g, ' ');
      if (prefs.spellReferences) {
        const digits = ['صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
        value = value.replace(/[0-9٠-٩۰-۹]+(?:[./-][0-9٠-٩۰-۹]+)+/gu, identifier => [...identifier].map(c => c === '.' ? 'نقطة' : c === '/' ? 'شرطة مائلة' : c === '-' ? 'شرطة' : digits[Number(normalize(c))]).join(' '));
      }
      const words = value.match(/\S+\s*/gu) || []; let buffer = '';
      for (const word of words) {
        if (buffer.length + word.length > 300 && buffer.trim()) { chunks.push({ text: buffer, block }); buffer = ''; }
        buffer += word;
        if (buffer.length > 170 && /[.؟!؛]\s*$/u.test(word)) { chunks.push({ text: buffer, block }); buffer = ''; }
      }
      if (buffer.trim()) chunks.push({ text: buffer, block });
    });
    return chunks.filter(c => c.text.trim());
  }
  async function startReading() {
    if (!state.document?.text?.trim()) { toast('لا يوجد نص متاح لقراءته صوتياً.'); return; }
    if (state.reading) { stopReading(); audioStatus('توقفت القراءة.'); return; }
    await stopMic(true); stopReading();
    if (prefs.readingEngine === 'local' && !state.capabilities.speech?.piperAvailable) { audioStatus('محرك القراءة المحلي غير متاح.', true); return; }
    populateVoices();
    const voice = state.voices.find(v => v.voiceURI === prefs.voice) || state.voices[0];
    if (prefs.readingEngine === 'browser' && (!('speechSynthesis' in window) || !voice)) { audioStatus('لا يتوفر صوت عربي محلي في المتصفح.', true); return; }
    const token = ++state.readingToken; state.reading = true; state.paused = false;
    const chunks = readingChunks(); let index = 0;
    $('listenBtn').classList.add('active'); $('listenBtn').textContent = '◖ جارٍ الاستماع'; $('pauseReadBtn').disabled = false; $('stopReadBtn').disabled = false;
    const playNext = async () => {
      if (token !== state.readingToken || !state.reading) return;
      if (index >= chunks.length) { stopReading(); audioStatus('اكتملت قراءة النص المتاح.'); return; }
      const chunk = chunks[index]; $('readerBody').querySelectorAll('.reading-current').forEach(el => el.classList.remove('reading-current')); chunk.block.classList.add('reading-current');
      audioStatus('قراءة المقطع ' + fmt(index + 1) + ' من ' + fmt(chunks.length) + (state.document.textKind === 'source_summary' ? ' · ملخص المصدر' : ''));
      if (prefs.readingEngine === 'local') {
        try {
          const response = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: chunk.text }), signal: AbortSignal.timeout(35000) });
          if (!response.ok || !response.headers.get('content-type')?.includes('audio')) throw new Error('تعذّر توليد الصوت بالمحرك المحلي.');
          const blob = await response.blob(); if (token !== state.readingToken) return;
          if (state.audioURL) URL.revokeObjectURL(state.audioURL); state.audioURL = URL.createObjectURL(blob);
          const audio = new Audio(state.audioURL); state.audio = audio; audio.playbackRate = Number(prefs.rate) || 1;
          audio.onended = () => { index++; playNext(); }; audio.onerror = () => { stopReading(); audioStatus('تعذّر تشغيل الصوت المحلي.', true); };
          if (!state.paused) await audio.play();
        } catch (error) { if (token === state.readingToken) { stopReading(); audioStatus(error.message || 'تعذّر توليد الصوت.', true); } }
      } else {
        const utterance = new SpeechSynthesisUtterance(chunk.text); utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = Number(prefs.rate) || 1;
        utterance.onend = () => { index++; playNext(); };
        utterance.onerror = event => { if (token === state.readingToken && !['interrupted', 'canceled'].includes(event.error)) { stopReading(); audioStatus('تعذرت القراءة بهذا الصوت. اختر صوتاً محلياً آخر.', true); } };
        speechSynthesis.speak(utterance); if (state.paused) speechSynthesis.pause();
      }
    };
    playNext();
  }
  function pauseReading() {
    if (!state.reading) return;
    state.paused = !state.paused; $('pauseReadBtn').textContent = state.paused ? 'استئناف' : 'إيقاف مؤقت';
    if (prefs.readingEngine === 'local') { if (state.audio) state.paused ? state.audio.pause() : state.audio.play().catch(() => audioStatus('تعذّر استئناف الصوت.')); }
    else state.paused ? speechSynthesis.pause() : speechSynthesis.resume();
  }

  function micStatus(message, recording = false) {
    const inAssistant = $('assistant').open;
    $('micStatus').hidden = !message || inAssistant; $('micStatus').classList.toggle('recording', recording); $('micStatus').textContent = message;
    $('askMicStatus').hidden = !message || !inAssistant; $('askMicStatus').textContent = message;
    $('searchMic').classList.toggle('recording', recording); $('searchMic').setAttribute('aria-label', recording ? 'إيقاف الإملاء الصوتي' : 'الإملاء الصوتي للبحث');
    $('bottomSearchMic').classList.toggle('recording', recording);
    $('askMic').classList.toggle('recording', recording); $('askMic').title = recording ? 'إيقاف الإملاء' : 'إملاء السؤال';
    if (recording) { const stop = document.createElement('button'); stop.textContent = 'إيقاف'; stop.addEventListener('click', () => stopMic()); (inAssistant ? $('askMicStatus') : $('micStatus')).append(stop); }
  }
  function insertDictation(target, text) {
    const value = String(text || '').trim(); if (!value) { micStatus('لم يُلتقط نص واضح. يمكنك المحاولة مجدداً.'); return; }
    target.value = (target.value.trim() ? target.value.trim() + ' ' : '') + value;
    if (target === $('query') || target === $('queryBottom')) { $('query').value = $('queryBottom').value = target.value; state.page = 1; runSearch(); }
    micStatus('تم إدراج الإملاء. راجع الأسماء والأرقام والمصطلحات قبل اعتماده.'); target.focus();
    if (target === $('askInput')) toast('أُدرج الإملاء في السؤال. راجع النص قبل إرساله.');
  }
  function wavBlob(chunks, rate) {
    const length = chunks.reduce((n, a) => n + a.length, 0); const input = new Float32Array(length); let position = 0;
    chunks.forEach(chunk => { input.set(chunk, position); position += chunk.length; });
    const ratio = rate / 16000; const outLength = Math.floor(input.length / ratio); const buffer = new ArrayBuffer(44 + outLength * 2); const view = new DataView(buffer);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + outLength * 2, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, outLength * 2, true);
    for (let i = 0; i < outLength; i++) { const start = Math.floor(i * ratio); const end = Math.max(start + 1, Math.min(input.length, Math.floor((i + 1) * ratio))); let sum = 0; for (let p = start; p < end; p++) sum += input[p]; const sample = Math.max(-1, Math.min(1, sum / (end - start))); view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true); }
    return new Blob([buffer], { type: 'audio/wav' });
  }
  async function stopMic(cancel = false) {
    const mic = state.mic; if (!mic) return;
    state.mic = null; state.recording = false; clearTimeout(state.micTimer); micStatus(cancel ? '' : 'جارٍ تحويل الصوت إلى نص…');
    if (mic.kind === 'browser') { mic.cancelled = cancel; try { cancel ? mic.recognition.abort() : mic.recognition.stop(); } catch {} return; }
    mic.stream?.getTracks().forEach(track => track.stop()); mic.node?.disconnect(); mic.source?.disconnect();
    try { await mic.context?.close(); } catch {}
    if (cancel) return;
    if (!mic.chunks.length) { micStatus('لم يُلتقط صوت كافٍ.'); return; }
    try {
      const blob = wavBlob(mic.chunks, mic.rate); if (blob.size > 4200000) throw new Error('مدة الصوت أطول من الحد المتاح.');
      const result = await api('/api/stt', { method: 'POST', body: blob, headers: { 'Content-Type': 'audio/wav' }, signal: AbortSignal.timeout(60000) });
      insertDictation(mic.target, result.text);
      if (result.warnings?.length) toast(result.warnings.join(' · '));
    } catch (error) { micStatus(error.message || 'تعذّر التعرف المحلي. لم يُرسل الصوت إلى خدمة بديلة.'); toast('تعذّر الإملاء المحلي؛ لم يُستخدم بديل عبر الشبكة.'); }
  }
  async function startMic(target) {
    if (state.mic) { await stopMic(); return; }
    stopReading();
    if (prefs.dictationEngine === 'browser') {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) { toast('خدمة التعرف الصوتي غير مدعومة في هذا المتصفح.'); openSettings(); return; }
      const recognition = new Recognition(); const mic = { kind: 'browser', recognition, target, cancelled: false, pieces: [] };
      recognition.lang = 'ar-MA'; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
      recognition.onresult = event => { let interim = ''; for (let i = event.resultIndex; i < event.results.length; i++) { if (event.results[i].isFinal) mic.pieces.push(event.results[i][0].transcript); else interim += event.results[i][0].transcript; } micStatus('خدمة المتصفح قيد الاستماع — قد تستخدم الشبكة. ' + interim.slice(0, 95), true); };
      recognition.onerror = event => { if (!mic.cancelled) { mic.cancelled = true; micStatus(event.error === 'not-allowed' ? 'لم يُمنح إذن الميكروفون.' : 'توقفت خدمة المتصفح: ' + event.error); toast('لم يكتمل الإملاء الصوتي.'); } };
      recognition.onend = () => { if (state.mic === mic) { state.mic = null; state.recording = false; clearTimeout(state.micTimer); } if (!mic.cancelled && mic.pieces.length) insertDictation(target, mic.pieces.join(' ')); else if (!mic.cancelled) micStatus('انتهى الاستماع دون نص واضح.'); $('searchMic').classList.remove('recording'); $('askMic').classList.remove('recording'); };
      try { state.mic = mic; recognition.start(); state.recording = true; micStatus('خدمة المتصفح قيد الاستماع — قد تستخدم الشبكة.', true); state.micTimer = setTimeout(() => stopMic(), 90000); }
      catch { state.mic = null; micStatus('تعذّر بدء خدمة التعرف في المتصفح.'); }
      return;
    }
    if (!state.capabilities.speech?.sttAvailable) { toast('الإملاء المحلي غير متاح. يمكنك اختيار خدمة المتصفح صراحة من التفضيلات.'); openSettings(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { toast('الميكروفون غير مدعوم أو الصفحة ليست في سياق آمن.'); return; }
    let stream, context;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      context = new (window.AudioContext || window.webkitAudioContext)(); await context.resume(); const source = context.createMediaStreamSource(stream);
      const mic = { kind: 'local', stream, context, source, node: null, chunks: [], rate: context.sampleRate, target };
      if (context.audioWorklet && window.AudioWorkletNode) {
        await context.audioWorklet.addModule('/assets/recorder-worklet.js');
        mic.node = new AudioWorkletNode(context, 'qalam-recorder'); mic.node.port.onmessage = event => { if (state.mic === mic) mic.chunks.push(new Float32Array(event.data)); };
      } else {
        mic.node = context.createScriptProcessor(4096, 1, 1); mic.node.onaudioprocess = event => { if (state.mic === mic) mic.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0))); };
      }
      state.mic = mic; state.recording = true; source.connect(mic.node); mic.node.connect(context.destination); micStatus('المحرك المحلي: جارٍ تسجيل الصوت. اضغط إيقاف عند الانتهاء.', true); state.micTimer = setTimeout(() => stopMic(), 90000);
    } catch (error) { stream?.getTracks().forEach(track => track.stop()); try { await context?.close(); } catch {} state.mic = null; state.recording = false; micStatus(error.name === 'NotAllowedError' ? 'لم يُمنح إذن الميكروفون.' : 'تعذّر بدء تسجيل الصوت المحلي.'); }
  }

  function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebarScrim').hidden = true; $('menuToggle').setAttribute('aria-expanded', 'false'); }
  function wireEvents() {
    document.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!event.target.closest('.search-form,.bottom-search-form')) closeSuggestions();
      if (!button || button.disabled) return;
      if (button.dataset.view) { setView(button.dataset.view); return; }
      if (button.dataset.query !== undefined) { applyQuery(button.dataset.query); return; }
      if (button.hasAttribute('data-browse-back')) { state.browseGroup = ''; renderBrowseGroup(''); return; }
      if (button.dataset.category !== undefined) {
        const fromBrowse = !!button.closest('#browseContent'), group = state.browseGroup, selectedCategory = state.categories.find(c => c.name === button.dataset.category);
        state.page = 1; state.topic = ''; state.category = button.dataset.category;
        if (selectedCategory?.group === 'materials') {
          state.topic = button.dataset.category; if (!state.scopeTouched) state.scope = 'all'; if (state.scope !== 'all') state.category = '';
        }
        if (fromBrowse) {
          if (group === 'materials') { state.topic = button.dataset.category; if (!state.scopeTouched) state.scope = 'all'; state.category = state.scope === 'all' ? button.dataset.category : ''; }
          else if (group === 'judicial') { state.scope = 'jurisprudence'; state.category = button.dataset.category; }
          else if (group === 'studies') { state.scope = 'studies'; state.category = button.dataset.category; }
          else { state.scope = 'all'; state.category = button.dataset.category; }
          $('browsePanel').hidden = true; $('browseToggle').setAttribute('aria-expanded','false'); state.browseGroup = ''; $('browseGroups').hidden = false; $('browseContent').hidden = true;
        }
        document.querySelectorAll('[data-scope]').forEach(b => { const active = b.dataset.scope === state.scope; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
        if (state.view !== 'library') setView('library'); else runSearch(); renderCategories(); closeSidebar(); return;
      }
      if (button.hasAttribute('data-clear-category')) { state.category = ''; state.topic = ''; state.page = 1; renderCategories(); runSearch(); return; }
      if (button.dataset.scope) { state.scope = button.dataset.scope; state.scopeTouched = true; if (state.topic && state.scope !== 'all') state.category = ''; else if (state.topic && state.scope === 'all') state.category = state.topic; state.page = 1; document.querySelectorAll('[data-scope]').forEach(b => { const active = b === button; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); }); renderCategories(); runSearch(); return; }
      if (button.dataset.browseGroup) { renderBrowseGroup(button.dataset.browseGroup); return; }
      if (button.dataset.expandDoc) {
        const id = button.dataset.expandDoc;
        if (state.expandedCard === id) { state.expandedCard = ''; $('results').innerHTML = state.results.map(renderCard).join(''); return; }
        state.expandedCard = id; $('results').innerHTML = state.results.map(renderCard).join('');
        if (!state.previewCache.has(id)) {
          const target = $('results').querySelector('[data-expand-doc="' + CSS.escape(id) + '"]');
          api('/api/document?id=' + encodeURIComponent(id)).then(doc => { state.previewCache.set(id, doc.text || 'لا يتوفر نص قابل للقراءة لهذه البطاقة.'); if (state.expandedCard === id) $('results').innerHTML = state.results.map(renderCard).join(''); }).catch(() => { state.previewCache.set(id, 'تعذر تحميل النص المتاح.'); if (state.expandedCard === id) $('results').innerHTML = state.results.map(renderCard).join(''); });
        }
        return;
      }
      if (button.dataset.open) { openDocument(button.dataset.open, $('query').value.trim()); return; }
      if (button.dataset.save) { toggleSaved(button.dataset.save); return; }
      if (button.dataset.suggestion !== undefined) { pickSuggestion(Number(button.dataset.suggestion)); return; }
      if (button.dataset.page) { state.page = Number(button.dataset.page); runSearch(); $('resultsTitle').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      if (button.dataset.heading !== undefined) { const id = 'doc-heading-' + button.dataset.heading; const heading = $(id); heading?.scrollIntoView({ block: 'start', behavior: 'smooth' }); $('outline').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === button)); if (window.innerWidth <= 720) { document.querySelector('.reader-outline').classList.remove('open'); $('mobileOutline').setAttribute('aria-expanded', 'false'); } return; }
      if (button.dataset.sourceOpen) { openDocument(button.dataset.sourceOpen); return; }
      if (button.id === 'clearTopQuery' || button.id === 'clearBottomQuery') { clearSearchQuery(); return; }
      if (button.hasAttribute('data-remove-context')) { state.askDocument = null; renderAssistantContext(); return; }
      if (button.dataset.ask) { $('askInput').value = button.dataset.ask; $('askInput').focus(); return; }
      if (button.dataset.action === 'settings') openSettings();
      if (button.dataset.action === 'library') setView('library');
      if (button.dataset.action === 'retry') runSearch();
      if (button.dataset.action === 'clear-filters') clearFilters();
    });
    const submitSearch = event => { event.preventDefault(); if (state.selectedSuggestion >= 0 && !$('suggestions').hidden) pickSuggestion(state.selectedSuggestion); else { closeSuggestions(); state.page = 1; rememberQuery($('query').value.trim()); runSearch(); } };
    $('searchForm').addEventListener('submit', submitSearch); $('bottomSearchForm').addEventListener('submit', submitSearch);
    for (const id of ['query','queryBottom']) {
      const input = $(id);
      input.addEventListener('input', () => { $('query').value = $('queryBottom').value = input.value; $('clearTopQuery').hidden = $('clearBottomQuery').hidden = !input.value.trim(); state.activeQueryId = id; scheduleSearch(); clearTimeout(state.suggestTimer); state.suggestTimer = setTimeout(suggest, 80); });
      input.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); navigateSuggestions(1); } if (event.key === 'ArrowUp') { event.preventDefault(); navigateSuggestions(-1); } if (event.key === 'Escape') closeSuggestions(); });
      input.addEventListener('focus', () => { state.activeQueryId = id; if (input.value.trim().length >= 2) suggest(); });
    }
    $('resetCategory').addEventListener('click', () => { state.category = ''; state.topic = ''; state.page = 1; renderCategories(); runSearch(); });
    ['qualityFilter', 'dateFrom', 'dateTo'].forEach(id => $(id).addEventListener('change', () => { state.page = 1; runSearch(); }));
    $('clearFilters').addEventListener('click', clearFilters);
    $('clearTopQuery').addEventListener('click', clearSearchQuery); $('clearBottomQuery').addEventListener('click', clearSearchQuery);
    $('clearHistory').addEventListener('click', () => { state.history = []; store.set('history', []); renderLocalView(); toast('مُسح سجل القراءة على هذا الجهاز.'); });
    ['settingsBtn', 'sidebarSettings', 'footerSettings'].forEach(id => $(id).addEventListener('click', openSettings));
    $('settingsClose').addEventListener('click', () => $('settings').close());$('settings').addEventListener('close',()=>clearTimeout(state.ocrSettingsTimer)); $('trustDetails').addEventListener('click', () => $('trustDialog').showModal()); $('trustClose').addEventListener('click', () => $('trustDialog').close());
    $('ocrStartBtn').addEventListener('click',()=>controlOCR($('ocrWorkerState').textContent==='متوقف مؤقتاً'?'resume':'start'));$('ocrPauseBtn').addEventListener('click',()=>controlOCR('pause'));$('ocrRefreshBtn').addEventListener('click',()=>refreshOCRSettings(false));
    $('ocrWorkers').addEventListener('change',event=>{ocrPrefs.workers=Number(event.target.value)||2;store.set('ocrSettings',ocrPrefs);});$('ocrMaxPages').addEventListener('change',event=>{ocrPrefs.maxPages=Math.max(0,Math.min(10000,Number(event.target.value)||0));event.target.value=String(ocrPrefs.maxPages);store.set('ocrSettings',ocrPrefs);});
    $('personalize').addEventListener('change', event => { prefs.personalize = event.target.checked; persistPrefs(); toast(prefs.personalize ? 'فُعّل السجل والتخصيص على هذا الجهاز فقط.' : 'توقف حفظ القراءات وعمليات البحث الجديدة.'); });
    $('searchHistoryEnabled').addEventListener('change', event => { prefs.searchHistory = event.target.checked; if (!prefs.searchHistory) { state.queries = []; store.set('queries', []); } persistPrefs(); toast(prefs.searchHistory ? 'فُعّل سجل البحث؛ ستُحفظ عمليات البحث التالية محلياً.' : 'أُوقف سجل البحث وحُذفت العبارات المحفوظة محلياً.'); });
    $('dictationEngine').addEventListener('change', event => { stopMic(true); prefs.dictationEngine = event.target.value; persistPrefs(); refreshSettings(); });
    $('readingEngine').addEventListener('change', event => { stopReading(); prefs.readingEngine = event.target.value; persistPrefs(); refreshSettings(); });
    $('allowNetworkVoices').addEventListener('change', event => { stopReading(); prefs.allowNetworkVoices = event.target.checked; prefs.voice = ''; persistPrefs(); populateVoices(); refreshSettings(); });
    $('voiceSelect').addEventListener('change', event => { stopReading(); prefs.voice = event.target.value; persistPrefs(); });
    $('voiceTestBtn').addEventListener('click',testReadingVoice);
    $('editorialSearchBtn').addEventListener('click', searchEditorialDocuments);
    $('editorialOcrLoadBtn').addEventListener('click', useEditorialOcr);
    $('editorialOcr2LoadBtn').addEventListener('click', () => useEditorialOcr('paddle'));
    $('editorialOcr2RunBtn').addEventListener('click', startSecondaryOcr);
    $('editorialQuery').addEventListener('keydown', event => { if(event.key==='Enter'){event.preventDefault();searchEditorialDocuments();} });
    $('editorialResults').addEventListener('click', event => { const button=event.target.closest('[data-editorial-id]');if(button)openEditorialDocument(button.dataset.editorialId); });
    $('editorialHistory').addEventListener('click', event => { const button=event.target.closest('[data-editorial-revert]');if(button)revertEditorialCorrection(button.dataset.editorialRevert); });
    $('editorialPreviewBtn').addEventListener('click', previewEditorialChange); $('editorialSaveBtn').addEventListener('click', saveEditorialCorrection);
    ['editorialTitle','editorialText','editorialReason','editorialSourceUrl'].forEach(id => $(id).addEventListener('input', () => { resetEditorialPreview();$('editorialStatus').textContent='تغيرت البيانات؛ أعد معاينة الفروق قبل الحفظ.'; }));
    $('editorialConfirm').addEventListener('change', updateEditorialSave);
    $('spellReferences').addEventListener('change', event => { prefs.spellReferences = event.target.checked; stopReading(); persistPrefs(); });
    $('readRate').addEventListener('change', event => { prefs.rate = event.target.value; persistPrefs(); if (state.reading) { stopReading(); audioStatus('تغيّرت السرعة. اضغط استمع لبدء القراءة بالسرعة الجديدة.'); } });
    $('menuToggle').addEventListener('click', () => { const open = $('sidebar').classList.toggle('open'); $('sidebarScrim').hidden = !open; $('menuToggle').setAttribute('aria-expanded', String(open)); }); $('sidebarScrim').addEventListener('click', closeSidebar);
    $('browseToggle').addEventListener('click', () => { const open = $('browsePanel').hidden; $('browsePanel').hidden = !open; $('browseToggle').setAttribute('aria-expanded', String(open)); if (!open) { state.browseGroup = ''; $('browseContent').hidden = true; $('browseGroups').hidden = false; document.querySelectorAll('[data-browse-group]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); }); } });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('sidebar').classList.contains('open')) closeSidebar(); });
    $('readerClose').addEventListener('click', closeReader); $('reader').addEventListener('cancel', () => { saveNote(); stopReading(); state.documentAbort?.abort(); });
    $('reader').addEventListener('close', () => { saveNote(); stopReading(); });
    $('mobileOutline').addEventListener('click', () => { const open = document.querySelector('.reader-outline').classList.toggle('open'); $('mobileOutline').setAttribute('aria-expanded', String(open)); });
    $('readerBookmark').addEventListener('click', () => { if (state.document) toggleSaved(state.document.id, state.document); });
    $('copyCitation').addEventListener('click', async () => { if (!state.document) return; const citation = state.document.citation || state.document.title; toast(await copyText(citation) ? 'نُسخت الإحالة. راجع حالة النص عند الاستعمال.' : 'تعذّر النسخ التلقائي. يمكنك نسخ الإحالة من أسفل النص.'); });
    $('exportText').addEventListener('click', exportCurrent); $('readerScroll').addEventListener('scroll', updateReadingPosition, { passive: true });
    $('fontSmaller').addEventListener('click', () => { prefs.font = Math.max(13, prefs.font - 1); $('readerBody').style.fontSize = prefs.font + 'px'; persistPrefs(); });
    $('fontLarger').addEventListener('click', () => { prefs.font = Math.min(26, prefs.font + 1); $('readerBody').style.fontSize = prefs.font + 'px'; persistPrefs(); });
    let findTimer; $('readerFind').addEventListener('input', event => { clearTimeout(findTimer); findTimer = setTimeout(() => { stopReading(); renderReaderBody(event.target.value); }, 160); });
    $('findNext').addEventListener('click', () => moveFind(1)); $('findPrev').addEventListener('click', () => moveFind(-1));
    $('showNote').addEventListener('click', () => { $('documentNote').hidden = false; document.querySelector('.reader-outline').classList.remove('open'); $('mobileOutline').setAttribute('aria-expanded', 'false'); $('documentNote').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('noteText').focus(); });
    $('saveNote').addEventListener('click', () => saveNote(true)); let noteTimer; $('noteText').addEventListener('input', () => { $('noteStatus').textContent = 'جارٍ الحفظ محلياً…'; clearTimeout(noteTimer); noteTimer = setTimeout(() => saveNote(), 500); });
    $('navAssistant').addEventListener('click', () => openAssistant()); $('assistantClose').addEventListener('click', () => { stopMic(true); $('assistant').close(); });
    $('assistant').addEventListener('cancel', () => stopMic(true)); $('assistant').addEventListener('close', () => { stopMic(true); $('navAssistant').classList.remove('assistant-active'); $('navAssistant').setAttribute('aria-expanded', 'false'); });
    $('askAboutDoc').addEventListener('click', () => { if (state.document) openAssistant(state.document); });
    $('askForm').addEventListener('submit', event => { event.preventDefault(); askQuestion(); }); $('askInput').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); askQuestion(); } });
    $('listenBtn').addEventListener('click', startReading); $('pauseReadBtn').addEventListener('click', pauseReading); $('stopReadBtn').addEventListener('click', () => { stopReading(); audioStatus('توقفت القراءة.'); });
    $('searchMic').addEventListener('click', () => startMic($('query'))); $('bottomSearchMic').addEventListener('click', () => startMic($('queryBottom'))); $('askMic').addEventListener('click', () => startMic($('askInput')));
    document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if ($('reader').open) closeReader(); if ($('assistant').open) $('assistant').close(); $('query').focus(); $('query').select(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && $('reader').open && window.innerWidth > 720) { event.preventDefault(); $('readerFind').focus(); $('readerFind').select(); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopMic(true); }); window.addEventListener('pagehide', () => { stopMic(true); stopReading(); });
    if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', () => { if (prefs.readingEngine === 'browser') populateVoices(); });
    [$('settings'), $('trustDialog')].forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
  }
  async function initialize() {
    const readingSection = $('voiceAvailability').closest('section');
    const spelling = document.createElement('label'); spelling.className = 'switch-row spell-reference-setting';
    spelling.innerHTML = '<span><strong>تهجئة أرقام الإحالات المركبة</strong><small>قراءة كل رقم وفاصل في أرقام القوانين والملفات والتواريخ، دون تغيير النص المعروض.</small></span><input id="spellReferences" type="checkbox" role="switch">';
    readingSection.append(spelling); $('spellReferences').checked = !!prefs.spellReferences;
    wireEvents(); updateSavedCount(); populateVoices(); $('readRate').value = prefs.rate; $('results').innerHTML = skeletons();
    const responses = await Promise.allSettled([api('/api/stats'), api('/api/categories'), api('/api/capabilities')]);
    if (responses[0].status === 'fulfilled') {
      applyStats(responses[0].value);
    } else { $('connectionPill').textContent = 'الخدمة غير متاحة'; }
    if (responses[1].status === 'fulfilled') { state.categories = responses[1].value.categories || []; renderCategories(); } else $('categoryList').innerHTML = '<div class="sidebar-loading">تعذّر تحميل المجالات.</div>';
    if (responses[2].status === 'fulfilled') state.capabilities = responses[2].value;
    if (!state.voices.some(voice => voice.localService) && state.capabilities.speech?.piperAvailable && prefs.readingEngine === 'browser') { prefs.readingEngine = 'local'; persistPrefs(); }
    const ai = state.capabilities.ai || {}; $('assistantMode').textContent = ai.available ? (ai.mode === 'remote_model' ? 'نموذج متصل · إجابات مرتبطة بالمصادر' : 'نموذج محلي · إجابات مرتبطة بالمصادر') : 'استرجاع من المصادر · لا يوجد نموذج متصل';
    if (ai.available && ai.mode === 'remote_model') {
      const remoteNotice = document.createElement('p'); remoteNotice.className = 'privacy-callout'; remoteNotice.textContent = 'الوضع المتصل يرسل السؤال ومقتطفات المصادر إلى خدمة النموذج المهيّأة. تحقّق من مزود الخدمة قبل إدخال وقائع أو بيانات شخصية.'; $('askForm').prepend(remoteNotice);
    }
    refreshSettings(); pollIngestion(); await runSearch();
  }
  initialize();
})();
