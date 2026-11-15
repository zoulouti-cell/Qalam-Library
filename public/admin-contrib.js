'use strict';
/* فرع «إضافات وملاحظات المستخدمين» في لوحة الإدارة:
   الوارد وفرزه، عرض النص والأصول، التحويل إلى مسودة، البتّ برد للمستخدم،
   ومقابلة الأصل بالنص جنبًا إلى جنب في المحرر، ووجهة حفظ الأصول في Drive عند النشر. */
(() => {
  const $ = id => document.getElementById(id);
  const fmt = n => new Intl.NumberFormat('ar-MA').format(Number(n) || 0);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = v => v ? new Date(v).toLocaleString('ar-MA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const sizeOf = n => n >= 1048576 ? fmt(Math.round(n / 104857.6) / 10) + ' م.ب' : fmt(Math.max(1, Math.round(n / 1024))) + ' ك.ب';
  const httpsOnly = v => /^https:\/\//i.test(String(v || '')) ? String(v) : '';
  const STATUS_TONE = { pending: 'wait', reviewing: 'work', published: 'ok', accepted: 'ok', declined: 'no' };
  const ICON = {
    addition: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/><path d="M12 12v6"/><path d="M9 15h6"/></svg>',
    note: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></svg>',
  };
  const S = { type: '', status: '', q: '', page: 1, pages: 1, items: [], counts: { additions: {}, notes: {} }, statuses: {}, current: null, loaded: false, drive: null, driveAt: 0, editor: null, plan: null };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    let json = {}; try { json = await response.json(); } catch { /* غير JSON */ }
    if (!response.ok) throw new Error(json.error || 'تعذر إتمام الطلب.');
    return json;
  }
  const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  function message(text, ok = false) {
    const error = $('error'), notice = $('notice'); if (!error || !notice) return;
    error.hidden = ok || !text; notice.hidden = !ok || !text;
    if (ok) notice.textContent = text; else error.textContent = text;
    if (text) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ───────── الحصيلة والوسم ───────── */
  function renderStats() {
    const a = S.counts.additions || {}, n = S.counts.notes || {};
    const tiles = [['إضافات قيد الدرس', a.pending || 0, 'wait'], ['إضافات قيد التحرير', a.reviewing || 0, 'work'], ['إضافات نُشرت', a.published || 0, 'ok'], ['ملاحظات قيد الدرس', n.pending || 0, 'wait'], ['ملاحظات معتمدة', n.accepted || 0, 'ok']];
    $('contribStats').innerHTML = tiles.map(([label, value, tone]) => `<article class="tone-${tone}"><strong>${fmt(value)}</strong><span>${label}</span></article>`).join('');
    const waiting = (a.pending || 0) + (n.pending || 0), badge = $('contribBadge');
    if (badge) { badge.hidden = !waiting; badge.textContent = fmt(waiting); badge.setAttribute('aria-label', `${fmt(waiting)} في انتظار الدرس`); }
  }
  function renderStatusOptions() {
    const select = $('contribStatus'), keep = select.value;
    select.innerHTML = '<option value="">كل الحالات</option>' + Object.entries(S.statuses).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    select.value = keep;
  }

  /* ───────── الوارد ───────── */
  function rowHtml(item) {
    const isNote = item.type === 'note', tone = STATUS_TONE[item.status] || 'wait';
    return `<button type="button" class="cr-row ${S.current?.id === item.id ? 'on' : ''}" data-open="${esc(item.id)}">
      <span class="cr-icon ${isNote ? 'note' : ''}">${isNote ? ICON.note : ICON.addition}</span>
      <span class="cr-main"><strong>${esc(item.title || '—')}</strong><small>${esc(item.kindLabel)}${item.issuedAt ? ' · ' + esc(item.issuedAt) : ''} · <bdi dir="ltr">${esc(item.userEmail)}</bdi></small></span>
      <span class="cr-side"><span class="cpill ${tone}">${esc(item.statusLabel)}</span><small>${esc(when(item.updatedAt))}</small></span></button>`;
  }
  async function loadList() {
    const host = $('contribList');
    try {
      const params = new URLSearchParams({ page: String(S.page) }); if (S.type) params.set('type', S.type); if (S.status) params.set('status', S.status); if (S.q) params.set('q', S.q);
      const d = await api('/api/admin/contributions?' + params);
      S.items = d.items; S.pages = d.pages; S.page = d.page; S.counts = d.counts; S.statuses = d.statuses || S.statuses; S.loaded = true;
      renderStats(); renderStatusOptions();
      host.innerHTML = d.items.length ? d.items.map(rowHtml).join('') : `<p class="empty">${S.type || S.status || S.q ? 'لا نتائج مطابقة لهذا الفرز.' : 'لا إضافات ولا ملاحظات بعد. ستظهر هنا عند وصولها من المستخدمين.'}</p>`;
      $('contribPage').textContent = `صفحة ${fmt(d.page)} من ${fmt(d.pages)} · ${fmt(d.total)} عنصر`;
      $('contribPrev').disabled = d.page <= 1; $('contribNext').disabled = d.page >= d.pages;
    } catch (error) { host.innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
  }

  /* ───────── التفاصيل ───────── */
  const fileLinks = f => f.driveId
    ? { open: `/api/drive/file?id=${encodeURIComponent(f.driveId)}`, download: '' }
    : { open: `/api/admin/contributions/file?id=${encodeURIComponent(f.id)}`, download: `/api/admin/contributions/file?id=${encodeURIComponent(f.id)}&mode=download` };
  function originalsHtml(files, { purged = 0 } = {}) {
    if (!files?.length) return purged ? `<p class="muted">حُذفت الأصول (${fmt(purged)}) من الخادم عند عدم الاعتماد.</p>` : '<p class="muted">لا أصول مرفقة.</p>';
    return `<ul class="cd-files">${files.map((f, i) => {
      const link = fileLinks(f), viewable = f.ext !== 'docx', where = f.driveId ? `محفوظ في Drive${f.folderPath ? ' · ' + esc(f.folderPath) : ''}` : 'على الخادم مؤقتًا';
      return `<li><span class="cf-name"><b>${esc(f.name)}</b><small>${esc(String(f.ext || '').toUpperCase())} · ${sizeOf(f.size || 0)} · ${where}</small></span>
        <span class="cf-actions">${viewable ? `<button type="button" class="secondary" data-compare="${i}">مقابلة</button>` : ''}<a class="secondary" href="${link.download || link.open}" ${link.download ? '' : 'target="_blank" rel="noopener"'}>${link.download ? 'تنزيل' : 'فتح'}</a></span></li>`;
    }).join('')}</ul>`;
  }
  function metaRow(label, value, { ltr = false } = {}) { return value ? `<div><dt>${label}</dt><dd ${ltr ? 'dir="ltr"' : ''}>${value}</dd></div>` : ''; }

  function detailHtml(c) {
    const isNote = c.type === 'note', tone = STATUS_TONE[c.status] || 'wait', open = ['pending', 'reviewing'].includes(c.status);
    const link = httpsOnly(c.sourceUrl), source = link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(c.source || link)}</a>` : esc(c.source || '');
    const head = `<div class="cd-head"><span class="cr-icon ${isNote ? 'note' : ''}">${isNote ? ICON.note : ICON.addition}</span><div><small>${esc(isNote ? 'ملاحظة على وثيقة · ' + (c.noteTypeLabel || '') : 'إضافة · ' + (c.kindLabel || ''))}</small><h2>${esc(isNote ? c.documentTitle || c.documentId : c.title)}</h2></div><span class="cpill ${tone}">${esc(c.statusLabel)}</span><button type="button" class="close" data-act="close" aria-label="إغلاق التفاصيل">×</button></div>`;
    const meta = isNote
      ? metaRow('المرسل', `<bdi dir="ltr">${esc(c.userEmail)}</bdi>`) + metaRow('أُرسلت', esc(when(c.createdAt))) + metaRow('الوثيقة', `${esc(c.documentTitle || '')} <small class="muted"><bdi dir="ltr">${esc(c.documentId)}</bdi></small>`) + metaRow('الموضع المعني', c.excerpt ? `«${esc(c.excerpt)}»` : '')
      : metaRow('المرسل', `<bdi dir="ltr">${esc(c.userEmail)}</bdi>`) + metaRow('أُرسلت', esc(when(c.createdAt))) + metaRow('تاريخ الإصدار', esc(c.issuedAt)) + metaRow('المصدر', source) + metaRow('الجهة', esc(c.issuer)) + metaRow('المرجع', esc(c.reference)) + metaRow('طول النص', c.chars ? fmt(c.chars) + ' حرف' : '');
    const body = isNote
      ? `<section class="cd-block"><h3>الملاحظة</h3><pre class="cd-text" dir="auto">${esc(c.message)}</pre></section>`
      : `${c.note ? `<section class="cd-block"><h3>ملاحظة المرسل</h3><p class="cd-quote">${esc(c.note)}</p></section>` : ''}
         <section class="cd-block"><h3>الأصول المرفقة <b>${fmt(c.originalFiles?.length || 0)}</b></h3>${originalsHtml(c.originalFiles, { purged: c.originalsPurged })}${transferHtml(c)}</section>
         <section class="cd-block"><h3>النص المقروء</h3><details open><summary>عرض النص (${fmt(c.chars || (c.text || '').length)} حرف)</summary><pre class="cd-text" dir="auto">${esc(c.text)}</pre></details></section>`;
    const reply = c.adminReply ? `<section class="cd-block"><h3>ردّ الإدارة</h3><p class="cd-quote">${esc(c.adminReply)}</p></section>` : '';
    return `${head}<dl class="cd-meta">${meta}</dl>${body}${reply}${actionsHtml(c, open)}`;
  }
  function transferHtml(c) {
    const stuck = c.status === 'published' && (c.originalFiles || []).some(f => !f.driveId);
    if (!stuck) return '';
    return `<div class="cd-transfer"><p><b>لم تُنقل بعض الأصول إلى Drive.</b> بقيت على الخادم، ويمكن إعادة المحاولة (تأكدوا أن حساب الخدمة محرّر على مجلد الأصول).</p><div class="cd-row"><input id="cdSubfolder" type="text" maxlength="120" placeholder="عنوان مجلد جديد (اختياري)" aria-label="عنوان مجلد جديد في Drive"><button type="button" class="primary" data-act="transfer">نقل الأصول إلى Drive الآن</button></div></div>`;
  }
  function actionsHtml(c, open) {
    if (c.type === 'note') {
      const openDoc = `<button type="button" class="secondary" data-act="open-note-doc">فتح الوثيقة في المحرر</button>`;
      if (!open) return `<div class="cd-actions">${openDoc}</div>`;
      return `<div class="cd-actions"><label class="cd-reply">ردّ على المستخدم <small class="muted">(اختياري عند الاعتماد، إلزامي عند عدم الاعتماد)</small><textarea id="cdReply" rows="3" maxlength="2000" placeholder="مثال: تم تصحيح الإحالة في المادة 2. شكرًا على تنبيهكم."></textarea></label>
        <div class="cd-row">${openDoc}<button type="button" class="primary" data-act="accept">اعتماد الملاحظة</button><button type="button" class="danger" data-act="decline" data-confirm="تأكيد عدم الاعتماد">عدم الاعتماد</button></div><p id="cdError" class="cd-error" role="alert" hidden></p></div>`;
    }
    if (c.status === 'published') return `<div class="cd-actions">${c.publishedDocumentId ? '<button type="button" class="secondary" data-act="open-published">فتح الوثيقة المنشورة في المحرر</button>' : ''}</div>`;
    if (c.status === 'declined') return '';
    return `<div class="cd-actions"><div class="cd-row"><button type="button" class="primary" data-act="draft">${c.status === 'reviewing' ? 'متابعة التحرير في المحرر' : 'تحويل إلى مسودة وفتح المحرر'}</button></div>
      <details class="cd-decline"><summary>عدم اعتماد هذه الإضافة</summary><label class="cd-reply">سبب عدم الاعتماد <small class="muted">(يصل إلى صاحبها بالبريد وفي «إضافاتي»؛ وتُحذف أصولها من الخادم)</small><textarea id="cdReply" rows="3" maxlength="2000" placeholder="مثال: النص مكرر في المكتبة، أو الأصل غير مقروء؛ يرجى إعادة المسح بدقة أعلى."></textarea></label><div class="cd-row"><button type="button" class="danger" data-act="decline" data-confirm="تأكيد عدم الاعتماد">عدم الاعتماد</button></div><p id="cdError" class="cd-error" role="alert" hidden></p></details></div>`;
  }
  async function openItem(id) {
    const host = $('contribDetail'); host.hidden = false; host.innerHTML = '<p class="empty">جارٍ التحميل…</p>';
    try { S.current = await api('/api/admin/contributions/item?id=' + encodeURIComponent(id)); host.innerHTML = detailHtml(S.current); host.scrollIntoView({ behavior: 'smooth', block: 'start' }); document.querySelectorAll('.cr-row').forEach(r => r.classList.toggle('on', r.dataset.open === id)); }
    catch (error) { host.innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
  }
  function closeDetail() { S.current = null; $('contribDetail').hidden = true; closeDock(); document.querySelectorAll('.cr-row.on').forEach(r => r.classList.remove('on')); }
  const detailError = text => { const box = $('cdError'); if (!box) return message(text); box.textContent = text; box.hidden = !text; };
  const openEditor = id => window.dispatchEvent(new CustomEvent('qalam:open-draft', { detail: { id } }));

  async function onAct(button) {
    const c = S.current; if (!c) return; const act = button.dataset.act;
    if (act === 'close') return closeDetail();
    if (act === 'open-note-doc') return openEditor(c.documentId);
    if (act === 'open-published') return openEditor(c.publishedDocumentId);
    if (act === 'draft') {
      button.disabled = true;
      try { const d = await post('/api/admin/contributions/draft', { id: c.id }); message(d.existing ? 'المسودة قائمة؛ تابعوا تحريرها.' : 'أُنشئت مسودة من الإضافة. قابلوا النص بالأصل ثم صحّحوه واعتمدوه.', true); await loadList(); openEditor(d.documentId); closeDetail(); }
      catch (error) { button.disabled = false; detailError(error.message); }
      return;
    }
    if (act === 'accept' || act === 'decline') {
      const reply = ($('cdReply')?.value || '').trim();
      if (act === 'decline' && !reply) { const box = $('cdReply'); const details = box?.closest('details'); if (details) details.open = true; box?.focus(); return detailError('اكتبوا سبب عدم الاعتماد ليصل إلى صاحبها.'); }
      if (act === 'decline' && button.dataset.armed !== '1') { button.dataset.armed = '1'; button.textContent = button.dataset.confirm; setTimeout(() => { if (button.isConnected) { button.dataset.armed = ''; button.textContent = 'عدم الاعتماد'; } }, 5000); return; }
      button.disabled = true;
      try { await post('/api/admin/contributions/resolve', { id: c.id, status: act === 'accept' ? 'accepted' : 'declined', reply }); message(act === 'accept' ? 'اعتُمدت الملاحظة وأُبلغ صاحبها.' : 'سُجّل عدم الاعتماد وأُبلغ صاحبها بالسبب.', true); closeDetail(); await loadList(); }
      catch (error) { button.disabled = false; detailError(error.message); }
      return;
    }
    if (act === 'transfer') {
      button.disabled = true; button.textContent = 'جارٍ النقل…';
      try {
        const d = await post('/api/admin/originals/transfer', { documentId: c.publishedDocumentId, driveSubfolder: ($('cdSubfolder')?.value || '').trim() });
        message(d.originals.failed ? 'تعذر نقل بعض الأصول: ' + (d.originals.error || 'خطأ غير معروف') : `نُقلت ${fmt(d.originals.moved)} أصل إلى Drive (${d.originals.folder}) وحُذفت من الخادم.`, !d.originals.failed);
        await openItem(c.id);
      } catch (error) { button.disabled = false; button.textContent = 'نقل الأصول إلى Drive الآن'; detailError(error.message); }
    }
  }

  /* ───────── مقابلة الأصل بجانب المحرر ───────── */
  function closeDock() { const dock = $('originalDock'); if (!dock) return; dock.hidden = true; $('dockFrame').removeAttribute('src'); document.body.classList.remove('dock-open'); }
  function openDock(files, index = 0) {
    const list = files.filter(f => f.ext !== 'docx'); if (!list.length) return message('ملف Word لا يُعرض هنا؛ نزّلوه من القائمة.');
    const current = Math.min(Math.max(0, list.findIndex(f => f.id === files[index]?.id)), list.length - 1), file = list[current], link = fileLinks(file);
    $('dockTitle').textContent = file.name; $('dockOpen').href = link.open;
    $('dockTabs').innerHTML = list.length > 1 ? list.map((f, i) => `<button type="button" class="${i === current ? 'on' : ''}" data-dock="${i}" aria-label="الأصل ${fmt(i + 1)}">${fmt(i + 1)}</button>`).join('') : '';
    $('dockTabs').dataset.files = JSON.stringify(list.map(f => ({ id: f.id, name: f.name, ext: f.ext, driveId: f.driveId || '', size: f.size })));
    $('dockFrame').src = link.open; $('originalDock').hidden = false; document.body.classList.add('dock-open');
  }

  /* ───────── المحرر: الأصول ووجهة Drive ───────── */
  const editorFiles = () => S.editor?.originalFiles || [];
  const pendingOriginals = () => editorFiles().filter(f => !f.driveId);
  async function driveStatus() {
    if (S.drive && Date.now() - S.driveAt < 60000) return S.drive;
    try { S.drive = await api('/api/admin/originals/drive'); } catch (error) { S.drive = { ready: false, error: error.message }; }
    S.driveAt = Date.now(); return S.drive;
  }
  let planTimer = 0;
  function schedulePlan() { clearTimeout(planTimer); planTimer = setTimeout(refreshPlan, 250); }
  async function refreshPlan() {
    const box = $('publishDest'); if (!box || box.hidden) return;
    const q = new URLSearchParams({ kind: $('docKind').value, type: $('docType').value, category: $('docCategory').value, title: $('docTitle').value, issuer: S.editor?.issuer || '' });
    try { S.plan = await api('/api/admin/originals/section?' + q); } catch { S.plan = null; }
    const mode = box.querySelector('[name=destMode]:checked')?.value, sub = ($('driveSubfolder').value || '').trim();
    $('destSection').textContent = S.plan ? `القسم المخصص: «${S.plan.label}»${S.plan.court ? ' — في مجلد المحكمة المعنية إن وُجد' : ''}.` : 'يُحدَّد القسم من نوع الوثيقة وتصنيفها.';
    if (mode === 'new' && sub) $('destSection').textContent += ` وسيُنشأ داخله المجلد «${sub}».`;
    const d = await driveStatus();
    $('destStatus').className = 'muted ' + (d.ready ? 'ok' : 'warn');
    if (d.ready) $('destStatus').textContent = d.via === 'user' && d.account ? `ربط Drive جاهز للكتابة بحساب ${d.account}.` : 'ربط Drive جاهز للكتابة.';
    else $('destStatus').innerHTML = `Drive غير جاهز للكتابة: ${esc(d.error || 'تعذر الفحص')} — ستبقى الأصول على الخادم بعد النشر مع زر لإعادة النقل.${d.connectable ? ' <a href="/api/admin/drive/connect" target="_blank" rel="noopener">ربط Drive للكتابة</a> (يُفتح في تبويب جديد دون أن تفقد عملك)' : ''}`;
  }

  /* ───────── الإعدادات: ربط Drive للكتابة بحساب المدير ───────── */
  const DRIVE_RETURN = {
    connected: ['ok', 'تم ربط Drive بحسابك. ستُنقل الأصول المعتمدة إلى مجلد الأصول عند كل نشر، ويمكنك إعادة نقل ما تعثّر من المحرر.'],
    cancelled: ['warn', 'أُلغيت الموافقة في Google فلم يُربط شيء.'],
    scope: ['warn', 'لم تمنح Google صلاحية Drive كاملة؛ أعد المحاولة واترك خيار Drive محدّدًا في شاشة الموافقة.'],
    norefresh: ['warn', 'لم تُصدر Google رمز الربط الدائم؛ أعد المحاولة وسجّل الدخول بالحساب نفسه من جديد.'],
    folder: ['warn', 'الحساب الذي اخترته لا يملك صلاحية الكتابة في مجلد الأصول؛ أعد الربط بالحساب الذي يملك المجلد.'],
    denied: ['warn', 'انتهت جلسة الإدارة أثناء الربط؛ سجّل الدخول وأعد المحاولة.'],
    unavailable: ['warn', 'دخول Google غير مهيأ للمكتبة؛ تحقق من GOOGLE_OAUTH_CLIENT_ID وGOOGLE_OAUTH_CLIENT_SECRET في Render.'],
    failed: ['warn', 'تعذر إتمام الربط؛ أعد المحاولة بعد قليل.'],
  };
  function showDriveWriteMsg(kind, text) { const el = $('driveWriteMsg'); if (!el) return; el.hidden = !text; el.className = 'dw-msg ' + kind; el.textContent = text || ''; }
  function renderDriveCard(d) {
    const pill = $('driveWriteState'); if (!pill) return;
    const link = d.connection, connect = $('driveWriteConnect'), off = $('driveWriteDisconnect');
    let tone = 'bad', label = 'غير مربوط';
    if (link && d.ready) { tone = 'ok'; label = 'مربوط · جاهز للكتابة'; }
    else if (link && d.reauthorize) label = 'يلزم إعادة الربط';
    else if (link) label = 'مربوط · تعذّرت الكتابة';
    pill.textContent = label; pill.className = 'status-pill ' + tone;
    $('driveWriteAccount').textContent = link
      ? `الحساب المربوط: ${link.email || '—'} · منذ ${when(link.connectedAt)}${d.ready ? '' : ' — ' + (d.error || 'تعذر فحص الربط.')}`
      : (d.connectable === false ? 'دخول Google غير مهيأ للمكتبة؛ أضف GOOGLE_OAUTH_CLIENT_ID وGOOGLE_OAUTH_CLIENT_SECRET في Render لتفعيل الربط.' : 'لا يوجد حساب مربوط؛ تُجرَّب الكتابة بحساب الخدمة وهو بلا مساحة تخزين فتتعثر الأصول وتبقى على الخادم.');
    connect.hidden = d.connectable === false;
    connect.textContent = link ? 'إعادة الربط أو تبديل الحساب' : 'ربط Drive للكتابة';
    off.hidden = !link; off.classList.remove('confirm'); off.textContent = 'فك الربط';
  }
  async function loadDriveCard(force = true) {
    if (!$('driveWriteCard')) return;
    if (force) S.drive = null;
    $('driveWriteState').textContent = 'جارٍ التحقق'; $('driveWriteState').className = 'status-pill';
    renderDriveCard(await driveStatus());
  }
  let offTimer = 0;
  async function onDisconnectClick() {
    const btn = $('driveWriteDisconnect');
    if (!btn.classList.contains('confirm')) { btn.classList.add('confirm'); btn.textContent = 'تأكيد فك الربط'; clearTimeout(offTimer); offTimer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = 'فك الربط'; }, 6000); return; }
    clearTimeout(offTimer); btn.disabled = true;
    try { await post('/api/admin/drive/disconnect', {}); showDriveWriteMsg('ok', 'فُكّ الربط وأُلغي الرمز لدى Google. ستبقى الأصول الجديدة على الخادم حتى تربط حسابًا من جديد.'); }
    catch (error) { showDriveWriteMsg('warn', error.message); }
    btn.disabled = false; await loadDriveCard();
  }
  /* العودة من Google: ‎/admin?drive=…‎ تفتح الإعدادات وتعرض النتيجة ثم تُمسح من العنوان */
  function handleDriveReturn() {
    const code = new URLSearchParams(location.search).get('drive'); if (!code) return;
    const url = new URL(location.href); url.searchParams.delete('drive'); history.replaceState(null, '', url.pathname + url.search + url.hash);
    document.querySelector('[data-panel="settingsPanel"]')?.click();
    const [kind, text] = DRIVE_RETURN[code] || DRIVE_RETURN.failed;
    showDriveWriteMsg(kind, text); $('driveWriteCard')?.scrollIntoView({ block: 'center' });
  }
  function onEditorDoc(d) {
    S.editor = d && (d.originalFiles?.length || d.origin === 'contribution') ? d : null;
    const files = editorFiles(), box = $('editorOriginals');
    closeDock();
    if (!box) return;
    box.hidden = !S.editor;
    const draft = d?.reviewStatus === 'draft', pending = pendingOriginals().length > 0;
    $('publishDest').hidden = !(draft && pending);
    $('docSource').placeholder = S.editor ? 'اختياري لإضافات المستخدمين: يكفي المصدر المصرّح به أدناه' : 'صفحة عدالة/الجريدة الرسمية أو رابط PDF في Drive';
    if (!S.editor) { $('docSource').required = true; return; }
    $('docSource').required = false;
    $('eoCount').textContent = files.length ? fmt(files.length) + ' ملف' : 'لا ملفات';
    $('eoList').innerHTML = files.length ? files.map((f, i) => {
      const link = fileLinks(f);
      return `<li><span class="cf-name"><b>${esc(f.name)}</b><small>${esc(String(f.ext || '').toUpperCase())} · ${sizeOf(f.size || 0)} · ${f.driveId ? 'محفوظ في Drive' : 'على الخادم مؤقتًا'}</small></span><span class="cf-actions">${f.ext !== 'docx' ? `<button type="button" class="secondary" data-ecompare="${i}">مقابلة</button>` : ''}<a class="secondary" href="${link.download || link.open}" ${link.download ? '' : 'target="_blank" rel="noopener"'}>${link.download ? 'تنزيل' : 'فتح'}</a></span></li>`;
    }).join('') : '';
    $('eoCompare').hidden = !files.some(f => f.ext !== 'docx');
    $('eoHint').textContent = d?.sourceLabel ? `المصدر المصرّح به: ${d.sourceLabel}` : 'قابل النص بالأصل قبل الاعتماد.';
    if (draft && pending) { $('driveSubfolder').hidden = true; $('driveSubfolder').value = ''; const first = $('publishDest').querySelector('[value=section]'); if (first) first.checked = true; refreshPlan(); }
  }
  const publishOptions = () => {
    const box = $('publishDest'); if (!box || box.hidden) return {};
    const mode = box.querySelector('[name=destMode]:checked')?.value, sub = ($('driveSubfolder').value || '').trim();
    return mode === 'new' && sub ? { driveSubfolder: sub } : {};
  };
  function publishedNote(result) {
    const o = result?.originals; if (!o || !o.total) return '';
    if (o.failed) return ` تعذر نقل ${fmt(o.failed)} أصل إلى Drive (${o.error || 'خطأ غير معروف'}) فبقي على الخادم؛ أعيدوا المحاولة من «إضافات وملاحظات المستخدمين».`;
    return o.moved ? ` حُفظت ${fmt(o.moved)} أصل في Drive (${o.folder}) وحُذفت من الخادم فبقي النص وحده.` : '';
  }

  /* ───────── ربط الأحداث ───────── */
  function bind() {
    document.addEventListener('click', event => {
      const t = event.target;
      const type = t.closest('[data-ctype]'); if (type) { S.type = type.dataset.ctype; S.page = 1; document.querySelectorAll('[data-ctype]').forEach(b => b.classList.toggle('on', b === type)); loadList(); return; }
      const row = t.closest('[data-open]'); if (row) { openItem(row.dataset.open); return; }
      const act = t.closest('#contribDetail [data-act]'); if (act) { onAct(act); return; }
      const cmp = t.closest('[data-compare]'); if (cmp && S.current) { openDock(S.current.originalFiles || [], Number(cmp.dataset.compare)); return; }
      const ecmp = t.closest('[data-ecompare]'); if (ecmp) { openDock(editorFiles(), Number(ecmp.dataset.ecompare)); return; }
      if (t.closest('#eoCompare')) { openDock(editorFiles(), 0); return; }
      const tab = t.closest('[data-dock]'); if (tab) { const files = JSON.parse($('dockTabs').dataset.files || '[]'); openDock(files, Number(tab.dataset.dock)); return; }
      if (t.closest('#dockClose') || t.closest('#closeEditor')) closeDock();
    });
    $('contribStatus').addEventListener('change', event => { S.status = event.target.value; S.page = 1; loadList(); });
    let timer = 0; $('contribQuery').addEventListener('input', event => { clearTimeout(timer); timer = setTimeout(() => { S.q = event.target.value.trim(); S.page = 1; loadList(); }, 220); });
    $('contribPrev').addEventListener('click', () => { if (S.page > 1) { S.page--; loadList(); } });
    $('contribNext').addEventListener('click', () => { if (S.page < S.pages) { S.page++; loadList(); } });
    document.querySelector('.admin-tabs').addEventListener('click', event => { if (event.target.closest('[data-panel="contribPanel"]')) loadList(); if (event.target.closest('[data-panel="settingsPanel"]')) loadDriveCard(); });
    $('driveWriteRefresh')?.addEventListener('click', () => { showDriveWriteMsg('ok', ''); loadDriveCard(); });
    $('driveWriteDisconnect')?.addEventListener('click', onDisconnectClick);
    /* بعد الربط من تبويب آخر (رابط المحرر) تُحدَّث حالة Drive عند العودة إلى هذا التبويب */
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.drive && !S.drive.ready) { S.drive = null; if (!$('publishDest')?.hidden) refreshPlan(); } });
    setTimeout(handleDriveReturn, 0);
    ['docKind', 'docType', 'docCategory', 'docTitle'].forEach(id => $(id).addEventListener('input', schedulePlan));
    $('publishDest').addEventListener('change', event => {
      if (event.target.name === 'destMode') { const input = $('driveSubfolder'); input.hidden = event.target.value !== 'new'; if (!input.hidden) input.focus(); refreshPlan(); }
    });
    $('driveSubfolder').addEventListener('input', schedulePlan);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('originalDock').hidden) closeDock(); });
    /* حصيلة الوسم دون فتح الفرع، وتحديث هادئ كل دقيقة ونصف ما دامت الصفحة ظاهرة */
    loadList();
    setInterval(() => { if (!document.hidden) { const open = !$('contribPanel').hidden; if (open) loadList(); else api('/api/admin/contributions?page=1').then(d => { S.counts = d.counts; renderStats(); }).catch(() => {}); } }, 90000);
  }
  window.QalamAdminContrib = { onEditorDoc, publishOptions, publishedNote, refresh: loadList, openDock };
  bind();
})();
