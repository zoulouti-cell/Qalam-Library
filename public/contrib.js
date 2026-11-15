'use strict';
/* «إضافات» في المكتبة: إضافة نص قانوني أو اجتهاد أو بحث أو دراسة بأصلها ونصّها، وإرسال ملاحظات من صفحة الاطلاع.
   كل ما يصل إلى المدير يمرّ بمسودة يصحّحها ويعتمدها؛ والمستخدم يُشعَر بكل مرحلة (قيد الدرس ← اعتماد/نشر/رفض). */
(() => {
  const bridge = () => window.qalamBridge || {};
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => new Intl.NumberFormat('ar-MA').format(Number(n) || 0);
  const toast = message => (bridge().toast ? bridge().toast(message) : undefined);
  const sizeLabel = bytes => Number(bytes) >= 1048576 ? (Number(bytes) / 1048576).toFixed(1).replace('.', '٫') + ' م.ب' : Math.max(1, Math.round(Number(bytes) / 1024)) + ' ك.ب';
  const dateLabel = value => { try { return new Intl.DateTimeFormat('ar-MA', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value)); } catch { return ''; } };
  const svg = (paths, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICON = {
    add: svg('<path d="M12 5v14M5 12h14"/><rect x="3" y="3" width="18" height="18" rx="4"/>'),
    law: svg('<path d="M4 5h7v15H4zM14 5h6v15h-6zM7 8h1M17 8h1M7 16h1M17 16h1"/>', 22),
    jurisprudence: svg('<path d="m3 8 9-5 9 5M4 9h16M5 19h14M3 21h18M7 10v8M12 10v8M17 10v8"/>', 22),
    research: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M8 10.5h5M10.5 8v5"/>', 22),
    study: svg('<path d="M12 5C9 3 6 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z"/><path d="M12 5v15"/>', 22),
    note: svg('<path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M13 3l5 5v1.5"/><path d="M13 3v5h5"/><path d="M9 12h3M9 16h1.5"/><path d="M20.3 12.7a1.7 1.7 0 0 1 0 2.4l-5.2 5.2-3.1.8.8-3.1 5.2-5.3a1.7 1.7 0 0 1 2.3 0Z"/>'),
    printer: svg('<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/>'),
    camera: svg('<path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.6"/>'),
    reader: svg('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>'),
    file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', 18),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 22),
  };
  const STATUS_CLASS = { pending: 'wait', reviewing: 'work', published: 'ok', accepted: 'ok', declined: 'no' };
  const STEPS = ['النوع والبيانات', 'الأصل والنص', 'المراجعة والإرسال'];
  const ISSUER_LABEL = { law: 'الجهة المصدرة أو رقم النص (اختياري)', jurisprudence: 'المحكمة والغرفة', research: 'الجهة أو المجلة أو الجامعة (اختياري)', study: 'الجهة أو المجلة أو الجامعة (اختياري)' };
  const SOURCE_HINT = { law: 'مثال: الجريدة الرسمية عدد 6900 · موقع الأمانة العامة للحكومة', jurisprudence: 'مثال: مجلة قضاء محكمة النقض عدد 70 · موقع عدالة', research: 'مثال: مجلة المحاكم المغربية · أطروحة بجامعة محمد الخامس', study: 'مثال: مجلة القانون المدني · تقرير المجلس الاقتصادي والاجتماعي' };

  const S = { config: null, step: 1, tab: 'new', kind: '', title: '', issuedAt: '', source: '', sourceUrl: '', reference: '', issuer: '', note: '', text: '', files: [], pages: [], readTab: 'reader', busy: '', progress: 0, status: '', statusKind: '', error: '', done: null, mine: null, folder: null, autoTimer: 0, unread: 0 };
  const stateReset = () => Object.assign(S, { step: 1, kind: '', title: '', issuedAt: '', source: '', sourceUrl: '', reference: '', issuer: '', note: '', text: '', files: [], pages: [], busy: '', progress: 0, status: '', statusKind: '', error: '', done: null });

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.json ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: options.json ? JSON.stringify(options.json) : options.body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'تعذّر إتمام الطلب حالياً.'), { status: response.status });
    return data;
  }
  async function loadConfig() { if (!S.config) S.config = await request('/api/contributions/config').catch(() => ({ canSubmit: false, reason: 'تعذّر الاتصال بخدمة الإضافات حالياً.', kinds: [], noteTypes: [], limits: {} })); return S.config; }

  /* ───────── الإشعارات: شارة بجانب الزر + تنبيه عند وجود مستجدات ───────── */
  function paintBadge(count) {
    S.unread = count;
    for (const id of ['contribBadge', 'contribMineBadge']) { const node = $(id); if (node) { node.hidden = !count; node.textContent = fmt(count); } }
    const nav = $('navContrib'); if (nav) nav.classList.toggle('has-news', count > 0);
  }
  async function refreshUnread(announce = false) {
    try {
      const { unread } = await request('/api/contributions/unread'); const before = S.unread; paintBadge(unread);
      if (announce && unread > before) toast(unread === 1 ? 'لديكم مستجد بشأن إحدى إضافاتكم أو ملاحظاتكم. افتحوا «إضافات» ثم «إضافاتي وملاحظاتي».' : `لديكم ${fmt(unread)} مستجدات بشأن إضافاتكم وملاحظاتكم. افتحوا «إضافات» للاطلاع عليها.`);
    } catch { /* لا حساب فردي أو الخدمة غير متاحة: لا شارة */ }
  }

  /* ───────── نافذة «إضافات» ───────── */
  function ensureDialog() {
    if ($('contribDialog')) return $('contribDialog');
    const dialog = document.createElement('dialog');
    dialog.id = 'contribDialog'; dialog.className = 'settings-dialog contrib-dialog'; dialog.setAttribute('aria-labelledby', 'contribTitle');
    dialog.innerHTML = `<header class="simple-dialog-header contrib-head"><div class="contrib-title"><span class="contrib-title-icon" aria-hidden="true">${ICON.add}</span><h2 id="contribTitle">إضافات</h2></div><button class="icon-button" id="contribClose" type="button" aria-label="إغلاق">×</button></header>
      <div class="contrib-tabs" role="tablist" aria-label="أقسام الإضافات"><button type="button" role="tab" class="contrib-tab" data-tab="new" id="tabNew">إضافة جديدة</button><button type="button" role="tab" class="contrib-tab" data-tab="mine" id="tabMine">إضافاتي وملاحظاتي <b id="contribMineBadge" hidden></b></button></div>
      <div class="contrib-body" id="contribBody" tabindex="-1"></div>`;
    document.body.append(dialog);
    $('contribClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { clearInterval(S.autoTimer); S.autoTimer = 0; });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    dialog.querySelectorAll('.contrib-tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
    dialog.addEventListener('input', onInput); dialog.addEventListener('change', onChange); dialog.addEventListener('click', onClick);
    paintBadge(S.unread);
    return dialog;
  }
  async function openContrib(tab = 'new') {
    const dialog = ensureDialog(); bridge().closeSidebar?.();
    await loadConfig(); if (!dialog.open) dialog.showModal();
    switchTab(S.unread && S.config.canSubmit && tab === 'new' ? 'mine' : tab);
  }
  async function switchTab(tab) {
    S.tab = tab; const dialog = $('contribDialog');
    dialog.querySelectorAll('.contrib-tab').forEach(t => { const on = t.dataset.tab === tab; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
    if (tab === 'mine') { render(); await loadMine(); } else render();
    if (S.tab !== 'mine') clearInterval(S.autoTimer);
  }
  async function loadMine() {
    S.mine = null; render();
    try { S.mine = await request('/api/contributions/mine'); await request('/api/contributions/seen', { method: 'POST', json: {} }).catch(() => {}); paintBadge(0); }
    catch (error) { S.mine = { items: [], error: error.message }; }
    if (S.tab === 'mine') render();
  }

  /* ───────── العرض ───────── */
  function render() {
    const body = $('contribBody'); if (!body) return;
    const keepScroll = body.scrollTop;
    if (!S.config?.canSubmit) body.innerHTML = `<div class="contrib-empty"><span aria-hidden="true">${ICON.note}</span><h3>الإضافات متاحة للحسابات الفردية</h3><p>${esc(S.config?.reason || 'سجّلوا الدخول ببريدكم الإلكتروني لإضافة نصوص أو إرسال ملاحظات.')}</p></div>`;
    else body.innerHTML = S.tab === 'mine' ? renderMine() : S.done ? renderDone() : renderWizard();
    body.scrollTop = S.step === 1 && S.tab === 'new' ? keepScroll : body.scrollTop;
  }
  function stepper() { return `<ol class="contrib-steps" aria-label="مراحل الإضافة">${STEPS.map((label, i) => `<li class="${S.step === i + 1 ? 'current' : S.step > i + 1 ? 'done' : ''}" ${S.step === i + 1 ? 'aria-current="step"' : ''}><span>${S.step > i + 1 ? '✓' : fmt(i + 1)}</span>${esc(label)}</li>`).join('')}</ol>`; }
  function renderWizard() {
    const intro = '<p class="contrib-lead">أضيفوا نصًا إلى المكتبة: ترفقون الوثيقة الأصلية وتحمّلون نصّها، فتعرضها إدارة المكتبة على المدير مسودةً يصحّحها ويعتمدها وينشرها، وتصلكم الإشعارات في كل مرحلة.</p>';
    return `${intro}${stepper()}<div class="contrib-error" id="contribError" role="alert" ${S.error ? '' : 'hidden'}>${esc(S.error)}</div>${S.step === 1 ? stepOne() : S.step === 2 ? stepTwo() : stepThree()}`;
  }
  function stepOne() {
    const kinds = (S.config.kinds || []).map(k => `<label class="contrib-kind ${S.kind === k.id ? 'on' : ''}"><input type="radio" name="kind" value="${esc(k.id)}" ${S.kind === k.id ? 'checked' : ''}><span class="contrib-kind-icon">${ICON[k.id] || ICON.law}</span><strong>${esc(k.label)}</strong><small>${esc(k.hint)}</small></label>`).join('');
    return `<fieldset class="contrib-kinds"><legend>ماذا تضيفون؟</legend><div>${kinds}</div></fieldset>
      <div class="contrib-grid">
        <label class="contrib-field wide"><span>عنوان الوثيقة <i>*</i></span><input id="fTitle" maxlength="300" value="${esc(S.title)}" placeholder="العنوان كما ورد في الأصل" autocomplete="off"></label>
        <label class="contrib-field"><span>تاريخ الإصدار <i>*</i></span><input id="fIssuedAt" inputmode="numeric" maxlength="12" value="${esc(S.issuedAt)}" placeholder="يوم/شهر/سنة أو السنة وحدها" autocomplete="off" dir="ltr"></label>
        <label class="contrib-field"><span>${esc(ISSUER_LABEL[S.kind] || 'الجهة المصدرة (اختياري)')}</span><input id="fIssuer" maxlength="200" value="${esc(S.issuer)}" autocomplete="off"></label>
        <label class="contrib-field wide"><span>المصدر <i>*</i></span><input id="fSource" maxlength="300" value="${esc(S.source)}" placeholder="${esc(SOURCE_HINT[S.kind] || 'أين وجدتم هذه الوثيقة؟')}" autocomplete="off"></label>
        <label class="contrib-field wide"><span>رابط المصدر (اختياري)</span><input id="fSourceUrl" maxlength="1200" value="${esc(S.sourceUrl)}" placeholder="https://…" dir="ltr" autocomplete="off"></label>
      </div>
      <div class="contrib-actions"><span></span><button class="primary-button" type="button" data-act="next">التالي: الأصل والنص <span aria-hidden="true">←</span></button></div>`;
  }
  const READ_TABS = [{ id: 'folder', icon: 'printer', title: 'الماسح أو الطابعة' }, { id: 'camera', icon: 'camera', title: 'عدسة الهاتف' }, { id: 'reader', icon: 'reader', title: 'قارئ النصوص' }];
  function stepTwo() {
    const lim = S.config.limits || {};
    const tabs = READ_TABS.map(t => `<button type="button" role="tab" class="contrib-read-tab ${S.readTab === t.id ? 'on' : ''}" data-read-tab="${t.id}" aria-selected="${S.readTab === t.id}">${ICON[t.icon]}<span>${t.title}</span></button>`).join('');
    const files = S.files.length ? `<ul class="contrib-files">${S.files.map((f, i) => `<li>${ICON.file}<span class="name">${esc(f.name)}</span><small>${esc(f.ext.toUpperCase())} · ${sizeLabel(f.size)}</small><button type="button" class="contrib-x" data-act="drop-file" data-i="${i}" aria-label="إزالة ${esc(f.name)}">×</button></li>`).join('')}</ul>` : '<p class="contrib-muted">لم يُرفَق أي أصل بعد. الأصل شرط لقبول الإضافة.</p>';
    const busy = S.busy ? `<div class="contrib-progress" role="status"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(S.progress * 100)}"><span style="width:${Math.round(S.progress * 100)}%"></span></div><p>${esc(S.status || S.busy)}</p></div>` : S.status ? `<p class="contrib-status ${S.statusKind}" role="status">${esc(S.status)}</p>` : '';
    return `<section class="contrib-reader" aria-label="استيراد الأصل وقراءة نصه">
      <h3>استيراد من الماسح الضوئي</h3>
      <div class="contrib-read-tabs" role="tablist">${tabs}</div>
      <div class="contrib-read-pane">${readPane()}</div>${busy}
    </section>
    <section class="contrib-block"><h4>الأصول المرفقة <b>${fmt(S.files.length)}</b></h4>${files}<small class="contrib-muted">يُحفظ الأصل لدى المكتبة ليقابله المدير بالنص. الحد: ${fmt(lim.originalsPerItem || 10)} ملفات، ${sizeLabel(lim.originalBytes || 8388608)} للملف الواحد.</small></section>
    <section class="contrib-block"><h4>النص المقروء <b id="textCount">${fmt(S.text.trim().length)}</b> حرف</h4>
      <textarea id="fText" rows="10" dir="auto" placeholder="يظهر هنا النص المقروء من الأصل. يمكنكم تصحيحه أو لصق النص كاملًا مباشرة." ${S.busy ? 'readonly' : ''}>${esc(S.text)}</textarea>
      <small class="contrib-muted">القراءة الضوئية تجري داخل جهازكم، وقد تخطئ في الأسماء والأرقام والإحالات؛ راجعوا النص على الأصل قبل الإرسال. المدير يراجعه بدوره قبل أي نشر.</small></section>
    <div class="contrib-actions"><button class="secondary-button" type="button" data-act="prev"><span aria-hidden="true">→</span> السابق</button><button class="primary-button" type="button" data-act="next" ${S.busy ? 'disabled' : ''}>التالي: المراجعة والإرسال <span aria-hidden="true">←</span></button></div>`;
  }
  function readPane() {
    const R = window.QalamReader;
    if (S.readTab === 'folder') {
      if (!R?.folder.supported) return '<p class="contrib-muted">ربط مجلد الماسح متاح في Chrome وEdge على الحاسوب. على الهاتف استعملوا «عدسة الهاتف».</p>' + folderSteps();
      return `<div class="contrib-pane-row">${S.folder ? `<span class="contrib-chip">${ICON.printer}${esc(S.folder.name)}</span><button type="button" class="primary-button" data-act="folder-import" ${S.busy ? 'disabled' : ''}>استيراد آخر مسح</button><button type="button" class="secondary-button" data-act="folder-forget">فك الربط</button>` : '<button type="button" class="primary-button" data-act="folder-pick">اختيار مجلد الماسح</button>'}</div>
        ${S.folder ? `<label class="contrib-check"><input type="checkbox" id="folderAuto" ${S.autoTimer ? 'checked' : ''}> التقاط كل مسح جديد تلقائيًا ما دامت النافذة مفتوحة</label>` : ''}${folderSteps()}`;
    }
    if (S.readTab === 'camera') {
      const thumbs = S.pages.map((p, i) => `<div class="contrib-thumb"><img src="${p.url}" alt="الصفحة ${fmt(i + 1)}"><button type="button" class="contrib-x" data-act="drop-page" data-i="${i}" aria-label="حذف الصفحة ${fmt(i + 1)}">×</button><span>${fmt(i + 1)}</span></div>`).join('');
      return `<div class="contrib-pane-row"><label class="primary-button contrib-file-btn">${ICON.camera} ${S.pages.length ? 'صفحة أخرى' : 'تصوير الصفحة الأولى'}<input type="file" id="cameraInput" accept="image/*" capture="environment" hidden></label>${S.pages.length ? `<span class="contrib-muted">${fmt(S.pages.length)} صفحة</span>` : ''}</div>
        ${thumbs ? `<div class="contrib-thumbs">${thumbs}</div><div class="contrib-pane-row"><button type="button" class="primary-button" data-act="camera-merge" ${S.busy ? 'disabled' : ''}>دمج وقراءة</button></div>` : ''}
        <ol class="contrib-hints"><li>ضعوا الورقة على سطح داكن في ضوء جيد، دون ظل ولا انعكاس.</li><li>صوّروها من فوق مباشرة حتى تملأ الصورة، صفحةً صفحة بالترتيب.</li><li>تُدمج الصفحات في ملف PDF واحد يُحفظ أصلًا للإضافة.</li></ol>`;
    }
    return `<label class="contrib-drop"><input type="file" id="readerInput" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,application/pdf,image/*" multiple hidden>${ICON.reader}<span class="t">اختيار صورة أو PDF أو Word</span><span class="s">PNG · JPG · PDF · DOCX · TXT</span></label>
      <ol class="contrib-hints"><li>PDF النصي وملف Word يُقرآن فورًا؛ الصورة والـ PDF الممسوح يُقرآن بالتعرف الضوئي على الحروف (العربية والفرنسية).</li><li>للحصول على أدق قراءة: صورة واضحة مستقيمة، بدقة 300 نقطة، دون ظل.</li><li>القراءة تتم داخل جهازكم؛ والملف نفسه يُحفظ أصلًا للإضافة.</li></ol>`;
  }
  const folderSteps = () => '<ol class="contrib-hints"><li>في برنامج الماسح (تطبيق «المسح» في Windows، HP Smart، Epson ScanSmart، Canon IJ Scan Utility، أو «التقاط الصور» في Mac) اختاروا الحفظ في مجلد واحد، بصيغة PDF أو JPEG، وبدقة 300 نقطة.</li><li>اختاروا المجلد نفسه هنا مرة واحدة.</li><li>امسحوا الوثيقة ثم اضغطوا «استيراد آخر مسح».</li></ol>';
  function stepThree() {
    const row = (k, v) => v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '';
    const kind = (S.config.kinds || []).find(k => k.id === S.kind)?.label || '';
    const preview = S.text.trim().slice(0, 700);
    return `<dl class="contrib-summary">${row('النوع', kind)}${row('العنوان', S.title)}${row('تاريخ الإصدار', S.issuedAt)}${row('المصدر', S.source)}${row(ISSUER_LABEL[S.kind]?.replace(' (اختياري)', '') || 'الجهة', S.issuer)}${row('الرابط', S.sourceUrl)}${row('الأصول المرفقة', fmt(S.files.length) + ' — ' + S.files.map(f => f.name).join('، '))}${row('طول النص', fmt(S.text.trim().length) + ' حرف')}</dl>
      <details class="contrib-preview"><summary>معاينة بداية النص</summary><pre dir="auto">${esc(preview)}${S.text.trim().length > 700 ? '…' : ''}</pre></details>
      <label class="contrib-field wide"><span>ملاحظة للمدير (اختياري)</span><textarea id="fNote" rows="3" maxlength="4000" placeholder="أي توضيح يفيد المراجعة: أجزاء غير واضحة في الأصل، أخطاء معروفة، مصدر بديل…">${esc(S.note)}</textarea></label>
      <div class="contrib-process"><strong>ماذا بعد الإرسال؟</strong><ol><li>تصير إضافتكم «قيد الدرس» ويطّلع عليها المدير.</li><li>يصحّح النص ويقابله بالأصل ثم يعتمده وينشره في المكتبة.</li><li>تصلكم الإشعارات هنا وبالبريد الإلكتروني عند الاعتماد والنشر أو عدم الاعتماد.</li></ol></div>
      <div class="contrib-actions"><button class="secondary-button" type="button" data-act="prev"><span aria-hidden="true">→</span> السابق</button><button class="primary-button" type="button" data-act="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'جارٍ الإرسال…' : 'إرسال إلى إدارة المكتبة'}</button></div>`;
  }
  function renderDone() {
    return `<div class="contrib-done"><span class="contrib-done-icon">${ICON.check}</span><h3>وصلت إضافتكم وهي الآن قيد الدرس</h3><p>«${esc(S.done.title)}» لدى إدارة المكتبة. سيطّلع عليها المدير، يصحّح نصّه على الأصل ثم يعتمده وينشره. ستصلكم الإشعارات هنا (في «إضافاتي وملاحظاتي») وعلى بريدكم الإلكتروني${S.config.mailNotices ? '' : ' متى فُعّل البريد'}.</p>
      <div class="contrib-actions center"><button class="secondary-button" type="button" data-act="another">إضافة وثيقة أخرى</button><button class="primary-button" type="button" data-act="goto-mine">متابعة إضافاتي</button></div></div>`;
  }
  function renderMine() {
    if (!S.mine) return '<p class="contrib-muted center">جارٍ تحميل إضافاتكم…</p>';
    if (S.mine.error) return `<div class="contrib-error">${esc(S.mine.error)}</div>`;
    const items = S.mine.items || [];
    if (!items.length) return '<div class="contrib-empty"><span aria-hidden="true">' + ICON.add + '</span><h3>لا إضافات بعد</h3><p>أضيفوا نصًا من «إضافة جديدة»، أو أرسلوا ملاحظة من زر الورقة والقلم في صفحة الاطلاع. ستظهر هنا مع حالة كل واحدة.</p></div>';
    return `<ul class="contrib-list">${items.map(item => {
      const cls = STATUS_CLASS[item.status] || 'wait', isNote = item.type === 'note', open = item.publishedDocumentId ? `<button type="button" class="secondary-button" data-act="open-doc" data-id="${esc(item.publishedDocumentId)}">فتح الوثيقة المنشورة</button>` : isNote && item.documentId ? `<button type="button" class="secondary-button" data-act="open-doc" data-id="${esc(item.documentId)}">فتح الوثيقة</button>` : '';
      return `<li class="contrib-item ${item.unread ? 'fresh' : ''}"><div class="contrib-item-top"><span class="contrib-item-icon">${isNote ? ICON.note : ICON[item.kind] || ICON.law}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.kindLabel)}${item.issuedAt ? ' · ' + esc(item.issuedAt) : ''} · أُرسلت ${esc(dateLabel(item.createdAt))}</small></div><span class="contrib-pill ${cls}">${esc(item.statusLabel)}</span></div>
        ${item.reply ? `<p class="contrib-reply"><b>ردّ الإدارة:</b> ${esc(item.reply)}</p>` : ''}${item.status === 'pending' ? '<p class="contrib-muted">وصلت إلى الإدارة وتنتظر دورها في الدرس.</p>' : item.status === 'reviewing' ? '<p class="contrib-muted">يراجع المدير النص ويقابله بالأصل الآن.</p>' : ''}
        <div class="contrib-item-foot">${item.originals ? `<small>${fmt(item.originals)} أصل مرفق</small>` : '<span></span>'}${open}</div></li>`;
    }).join('')}</ul>`;
  }

  /* ───────── التفاعل ───────── */
  function onInput(event) {
    const t = event.target;
    if (t.id === 'fTitle') S.title = t.value; else if (t.id === 'fIssuedAt') S.issuedAt = t.value; else if (t.id === 'fSource') S.source = t.value;
    else if (t.id === 'fSourceUrl') S.sourceUrl = t.value; else if (t.id === 'fIssuer') S.issuer = t.value; else if (t.id === 'fNote') S.note = t.value;
    else if (t.id === 'fText') { S.text = t.value; const c = $('textCount'); if (c) c.textContent = fmt(t.value.trim().length); }
  }
  function onChange(event) {
    const t = event.target;
    if (t.name === 'kind') { S.kind = t.value; document.querySelectorAll('.contrib-kind').forEach(l => l.classList.toggle('on', l.querySelector('input').checked)); const hint = $('fSource'); if (hint) hint.placeholder = SOURCE_HINT[S.kind] || ''; }
    else if (t.id === 'readerInput') { const files = [...t.files]; t.value = ''; addSources(files); }
    else if (t.id === 'cameraInput') { const file = t.files[0]; t.value = ''; if (file) addCameraPage(file); }
    else if (t.id === 'folderAuto') toggleAuto(t.checked);
  }
  function onClick(event) {
    const tab = event.target.closest('[data-read-tab]'); if (tab) { S.readTab = tab.dataset.readTab; render(); return; }
    const button = event.target.closest('[data-act]'); if (!button) return;
    const act = button.dataset.act, i = Number(button.dataset.i);
    if (act === 'next') next(); else if (act === 'prev') { S.step = Math.max(1, S.step - 1); S.error = ''; render(); }
    else if (act === 'drop-file') dropFile(i); else if (act === 'drop-page') { URL.revokeObjectURL(S.pages[i]?.url); S.pages.splice(i, 1); render(); }
    else if (act === 'camera-merge') mergeCamera(); else if (act === 'submit') submit();
    else if (act === 'folder-pick') folderPick(); else if (act === 'folder-import') folderImport(true); else if (act === 'folder-forget') folderForget();
    else if (act === 'another') { stateReset(); render(); } else if (act === 'goto-mine') switchTab('mine');
    else if (act === 'open-doc') { $('contribDialog').close(); bridge().openDocument?.(button.dataset.id); }
  }
  const fail = message => { S.error = message; render(); $('contribBody')?.scrollTo({ top: 0, behavior: 'smooth' }); return false; };
  function validateStepOne() {
    if (!S.kind) return fail('اختاروا نوع الإضافة: نص قانوني أو اجتهاد قضائي أو بحث أو دراسة.');
    if (S.title.trim().length < 3) return fail('أدخلوا عنوان الوثيقة (3 أحرف على الأقل).');
    if (!/\d{4}/.test(S.issuedAt.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)))) return fail('أدخلوا تاريخ الإصدار: يوم/شهر/سنة، أو السنة وحدها.');
    if (S.source.trim().length < 3) return fail('أدخلوا مصدر الوثيقة؛ ليتحقق المدير من أصلها.');
    if (S.sourceUrl.trim() && !/^https:\/\//i.test(S.sourceUrl.trim())) return fail('رابط المصدر يجب أن يبدأ بـ https:// أو يُترك فارغًا.');
    return true;
  }
  function next() {
    S.error = '';
    if (S.step === 1 && validateStepOne()) { S.step = 2; render(); }
    else if (S.step === 2) {
      if (S.busy) return;
      if (!S.files.length) return fail('أرفقوا النسخة الأصلية للوثيقة (PDF أو صورة أو Word)؛ الأصل شرط لقبول الإضافة.');
      if (S.text.trim().length < 40) return fail('النص قصير أو فارغ؛ اقرؤوا الأصل بإحدى الطرق أعلاه أو ألصقوا النص كاملًا.');
      S.step = 3; render();
    }
  }

  /* ───────── الأصول والقراءة ───────── */
  const say = (status, kind = '') => { S.status = status; S.statusKind = kind; };
  function paintProgress() { const wrap = document.querySelector('.contrib-progress'); if (!wrap) return; wrap.querySelector('span').style.width = Math.round(S.progress * 100) + '%'; wrap.querySelector('p').textContent = S.status; wrap.querySelector('.bar').setAttribute('aria-valuenow', String(Math.round(S.progress * 100))); }
  async function uploadOriginal(blob, name) {
    const limit = S.config.limits || {}; if (blob.size > (limit.originalBytes || 8388608)) throw new Error(`«${name}» أكبر من ${sizeLabel(limit.originalBytes || 8388608)}؛ اختاروا ملفًا أصغر.`);
    return request('/api/contributions/file', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) }, body: blob });
  }
  async function addSources(files, { merged = null } = {}) {
    if (!files.length || S.busy) return;
    const R = window.QalamReader; const lim = S.config.limits || {};
    if (!R) return fail('تعذّر تحميل قارئ النصوص؛ أعيدوا تحميل الصفحة.');
    if (S.files.length + files.length > (lim.originalsPerItem || 10)) return fail(`لا يتسع الطلب لأكثر من ${fmt(lim.originalsPerItem || 10)} أصول.`);
    S.error = ''; S.busy = 'جارٍ تجهيز الملفات…'; S.progress = 0.02; say('جارٍ تجهيز الملفات…'); render();
    const toRead = [];
    try {
      for (const [index, file] of files.entries()) {
        say(`رفع الأصل: ${file.name}`); S.progress = (index / files.length) * 0.3; paintProgress();
        let blob = file, name = file.name;
        if (R.isImage(file) && file.size > 1.2 * 1048576) { const c = await R.compressImage(file); blob = c.blob; name = name.replace(/\.\w+$/, '') + '.jpg'; }
        const stored = await uploadOriginal(blob, name); S.files.push(stored); toRead.push(file);
      }
      const result = await R.read(merged || toRead, { onProgress: (ratio, message) => { if (ratio !== null) S.progress = 0.3 + ratio * 0.7; if (message) S.status = message; paintProgress(); } });
      S.text = [S.text.trim(), result.text].filter(Boolean).join('\n\n');
      say(`اكتملت القراءة (${fmt(result.pages)} صفحة). ${result.notes.join(' ')} راجعوا النص وصححوه قبل المتابعة.`.trim(), result.quality.ok ? 'ok' : 'warn');
    } catch (error) {
      say(error.message || 'تعذرت القراءة.', 'error');
      if (S.files.length && !S.text.trim()) S.status += ' الأصل أُرفق؛ يمكنكم لصق النص يدويًا.';
    } finally { S.busy = ''; S.progress = 0; render(); }
  }
  async function dropFile(i) {
    const file = S.files[i]; if (!file) return; S.files.splice(i, 1); render();
    request('/api/contributions/file/delete', { method: 'POST', json: { id: file.id } }).catch(() => {});
  }
  async function addCameraPage(file) {
    try { const c = await window.QalamReader.compressImage(file, { maxSide: 2400, quality: 0.85 }); S.pages.push({ blob: c.blob, w: c.w, h: c.h, url: URL.createObjectURL(c.blob) }); render(); }
    catch { fail('تعذّر قراءة الصورة الملتقطة؛ أعيدوا التصوير.'); }
  }
  async function mergeCamera() {
    if (!S.pages.length || S.busy) return; const R = window.QalamReader;
    try {
      const pdf = await R.imagesToPdf(S.pages), pageFiles = S.pages.map((p, i) => new File([p.blob], `صفحة ${i + 1}.jpg`, { type: 'image/jpeg' })), count = S.pages.length;
      const pdfFile = new File([pdf], `مسح بعدسة الهاتف (${count} صفحة).pdf`, { type: 'application/pdf' });
      S.pages.forEach(p => URL.revokeObjectURL(p.url)); S.pages = [];
      await addSourcesMerged(pdfFile, pageFiles);
    } catch { fail('تعذّر دمج الصفحات في ملف PDF.'); }
  }
  /* الأصل المرفوع هو الـPDF المدموج، أما القراءة فعلى صور الصفحات (أدق من إعادة رسم الـPDF) */
  const addSourcesMerged = (pdfFile, pageFiles) => addSources([pdfFile], { merged: pageFiles });

  /* ───────── مجلد الماسح ───────── */
  async function loadFolder() { const R = window.QalamReader; if (!R?.folder.supported) return; S.folder = await R.folder.saved(); }
  async function folderPick() { try { S.folder = await window.QalamReader.folder.pick(); say('رُبط المجلد. امسحوا الوثيقة ثم اضغطوا «استيراد آخر مسح».'); } catch (e) { if (e?.name !== 'AbortError') say('لم يُمنح إذن قراءة مجلد الماسح.', 'error'); } render(); }
  async function folderForget() { await window.QalamReader.folder.forget(); S.folder = null; toggleAuto(false); render(); }
  async function folderImport(ask) {
    const R = window.QalamReader; if (!S.folder || S.busy) return;
    try {
      if (!(await R.folder.permit(S.folder, ask))) { if (ask) say('لم يُمنح إذن قراءة مجلد الماسح.', 'error'); render(); return; }
      const fresh = await R.folder.fresh(S.folder);
      if (!fresh.length) { if (ask) { say('لا مسح جديد في المجلد. امسحوا الوثيقة واحفظوها فيه، وستظهر هنا.', 'warn'); render(); } return; }
      await R.folder.markImported(fresh); await addSources(fresh);
    } catch (error) { say(error.message || 'تعذّر الاستيراد من المجلد.', 'error'); render(); }
  }
  function toggleAuto(on) { clearInterval(S.autoTimer); S.autoTimer = on ? setInterval(() => { if ($('contribDialog')?.open && S.step === 2 && S.readTab === 'folder') folderImport(false); }, 10000) : 0; }

  /* ───────── الإرسال ───────── */
  async function submit() {
    if (S.busy) return; S.busy = 'sending'; S.error = ''; render();
    try {
      const res = await request('/api/contributions/addition', { method: 'POST', json: { kind: S.kind, title: S.title, issuedAt: S.issuedAt, source: S.source, sourceUrl: S.sourceUrl, reference: S.reference, issuer: S.issuer, note: S.note, text: S.text, fileIds: S.files.map(f => f.id) } });
      S.done = { id: res.id, title: S.title.trim() }; S.busy = ''; const title = S.title; render(); toast(`أُرسلت «${title.slice(0, 60)}» إلى إدارة المكتبة وهي قيد الدرس.`);
    } catch (error) { S.busy = ''; S.step = 3; fail(error.message); }
  }

  /* ───────── ملاحظة على وثيقة (زر الورقة والقلم في صفحة الاطلاع) ───────── */
  function ensureNoteDialog() {
    if ($('contribNoteDialog')) return $('contribNoteDialog');
    const dialog = document.createElement('dialog'); dialog.id = 'contribNoteDialog'; dialog.className = 'settings-dialog contrib-dialog contrib-note-dialog'; dialog.setAttribute('aria-labelledby', 'noteDlgTitle');
    dialog.innerHTML = `<header class="simple-dialog-header contrib-head"><div class="contrib-title"><span class="contrib-title-icon" aria-hidden="true">${ICON.note}</span><h2 id="noteDlgTitle">ملاحظة إلى إدارة المكتبة</h2></div><button class="icon-button" id="noteDlgClose" type="button" aria-label="إغلاق">×</button></header><div class="contrib-body" id="noteDlgBody"></div>`;
    document.body.append(dialog);
    $('noteDlgClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    return dialog;
  }
  async function openNote() {
    const doc = bridge().state?.document; const dialog = ensureNoteDialog(); const body = $('noteDlgBody');
    if (!doc) { toast('افتحوا وثيقة أولًا ثم أرسلوا ملاحظتكم عليها.'); return; }
    await loadConfig();
    if (!S.config.canSubmit) { body.innerHTML = `<div class="contrib-empty"><span aria-hidden="true">${ICON.note}</span><h3>الملاحظات متاحة للحسابات الفردية</h3><p>${esc(S.config.reason)}</p></div>`; if (!dialog.open) dialog.showModal(); return; }
    const selection = String(window.getSelection?.().toString() || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    const types = (S.config.noteTypes || []).map((t, i) => `<option value="${esc(t.id)}" ${i === 0 ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
    body.innerHTML = `<p class="contrib-lead">تصلكم ملاحظتكم إلى المدير، ويُعلمكم بما انتهى إليه. لا تُعدَّل الوثيقة إلا بعد مراجعته.</p>
      <p class="contrib-doc-ref"><span>الوثيقة</span><strong>${esc(doc.title)}</strong></p>
      <div class="contrib-error" id="noteError" role="alert" hidden></div>
      <label class="contrib-field wide"><span>نوع الملاحظة</span><select id="noteType">${types}</select></label>
      <label class="contrib-field wide"><span>الموضع المعنيّ في النص (اختياري)</span><textarea id="noteExcerpt" rows="2" maxlength="800" placeholder="حدّدوا فقرة في النص قبل فتح هذه النافذة لتُنقل إلى هنا تلقائيًا">${esc(selection)}</textarea></label>
      <label class="contrib-field wide"><span>ملاحظتكم <i>*</i></span><textarea id="noteMessage" rows="5" maxlength="4000" placeholder="اشرحوا الخطأ أو النقص أو الاقتراح بدقة، مع المرجع إن وُجد."></textarea></label>
      <div class="contrib-actions"><span class="contrib-muted" id="noteStatus"></span><button class="primary-button" type="button" id="noteSend">إرسال الملاحظة</button></div>`;
    $('noteSend').addEventListener('click', async () => {
      const message = $('noteMessage').value.trim(), error = $('noteError'); error.hidden = true;
      if (message.length < 5) { error.textContent = 'اكتبوا ملاحظتكم (5 أحرف على الأقل).'; error.hidden = false; return; }
      $('noteSend').disabled = true; $('noteStatus').textContent = 'جارٍ الإرسال…';
      try {
        await request('/api/contributions/note', { method: 'POST', json: { documentId: doc.id, noteType: $('noteType').value, message, excerpt: $('noteExcerpt').value } });
        body.innerHTML = `<div class="contrib-done"><span class="contrib-done-icon">${ICON.check}</span><h3>وصلت ملاحظتكم وهي قيد الدرس</h3><p>سيطّلع عليها المدير وتصلكم نتيجتها هنا (في «إضافات ← إضافاتي وملاحظاتي») وبالبريد الإلكتروني.</p><div class="contrib-actions center"><button class="primary-button" type="button" id="noteOk">حسنًا</button></div></div>`;
        $('noteOk').addEventListener('click', () => dialog.close());
        S.mine = null;
      } catch (e) { error.textContent = e.message; error.hidden = false; $('noteSend').disabled = false; $('noteStatus').textContent = ''; }
    });
    if (!dialog.open) dialog.showModal(); setTimeout(() => $('noteMessage')?.focus(), 30);
  }

  /* ───────── الربط بالصفحة ───────── */
  function init() {
    $('navContrib')?.addEventListener('click', () => openContrib('new'));
    $('readerNote')?.addEventListener('click', openNote);
    loadFolder();
    refreshUnread(true).then(() => { if (S.unread && !document.hidden) { /* التنبيه عرض في refreshUnread */ } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUnread(true); });
    setInterval(() => { if (!document.hidden) refreshUnread(true); }, 120000);
    const params = new URLSearchParams(location.search); if (params.get('contrib')) openContrib(params.get('contrib') === 'mine' ? 'mine' : 'new');
  }
  window.qalamContrib = { open: openContrib, note: openNote };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
