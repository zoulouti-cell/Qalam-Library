/*
 * المكتبة المترابطة (فوق قارئ app.js عبر qalamBridge):
 * - الإحالات روابط: «الفصل 230 من ق.ل.ع» داخل أي نص تفتح الفصل نفسه.
 * - النص المذيَّل: تحت كل فصل من القوانين الأساسية زر «اجتهاد (ن)» بالقرارات التي أحالت عليه.
 * - مقارنة نسختين: زر «قارن» على كل فصل، يعرض نصه بجانب فصل من نص آخر، المضاف والمحذوف ظاهران.
 * - «أضِف إلى ملف»: يرسل الوثيقة (أو المقطع المحدد) إلى ملف في مكتب المستخدم على منصة قلم.
 */
(() => {
  const bridge = () => window.qalamBridge;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = async url => { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error('تعذر الطلب.'); return r.json(); };
  const OFFICE = 'https://qalam-office.onrender.com';

  /* «الفصل 230 من ق.ل.ع» / «المادة 204 من القانون رقم 58.25» / «الفصلين 38 و39 من قانون المسطرة المدنية» */
  const REF = /(?:ال)?(?:فصل|فصلين|فصول|مادة|مادتين|مواد)\s+[0-9٠-٩]{1,4}(?:[-–][0-9٠-٩]{1,3})?(?:\s*(?:و|،|,)\s*[0-9٠-٩]{1,4})*\s+(?:من|في)\s+(?:ال)?(?:قانون|ظهير|مدونة|مجموعة)?\s*(?:رقم\s*)?(?:[0-9]{1,3}\.[0-9]{2}|ق\s*\.?\s*[لمج]\s*\.?\s*[عمج]?\s*\.?|م\s*\.?\s*[أاتشح]\s*\.?\s*(?:ع\.?)?|الالتزامات والعقود|المسطرة المدنية|المسطرة الجنائية|القانون الجنائي|الجنائي|الأسرة|التجارة|الشغل|الحقوق العينية|السير|التحفيظ العقاري|الدستور|المحاماة)/gu;

  function linkify(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement?.closest('a,button,mark,.ref-link') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = [];
    while (walker.nextNode()) if (REF.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode), (REF.lastIndex = 0);
    for (const node of nodes) {
      const text = node.nodeValue; REF.lastIndex = 0;
      const frag = document.createDocumentFragment(); let last = 0, m;
      while ((m = REF.exec(text))) {
        frag.append(text.slice(last, m.index));
        const a = document.createElement('a'); a.href = '#'; a.className = 'ref-link'; a.dataset.ref = m[0]; a.textContent = m[0]; a.title = 'افتح الفصل في نصه';
        frag.append(a); last = m.index + m[0].length;
      }
      frag.append(text.slice(last)); node.replaceWith(frag);
    }
  }

  async function openRef(text) {
    try {
      const r = await get('/api/refs/resolve?text=' + encodeURIComponent(text));
      if (r.id) bridge().openDocument(r.id, r.needle || '');
      else bridge().toast('هذا القانون غير متاح بعد في المكتبة.');
    } catch { bridge().toast('تعذر فتح الإحالة.'); }
  }

  const headingNumber = el => (String(el.textContent).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/^\s*(?:ال)?(?:فصل|مادة|ماده)\s+(\d{1,4}(?:[-–]\d{1,3})?)/u) || [])[1]?.replace('–', '-');

  async function annotate(body, doc) {
    const heads = [...body.querySelectorAll('h3')].filter(h => headingNumber(h) && !h.querySelector('.article-tools'));
    if (!heads.length) return;
    let data = { articles: {} };
    if (doc.type === 'national') { try { data = await get('/api/refs/annotations?doc=' + encodeURIComponent(doc.id)); } catch { /* بلا اجتهاد */ } }
    if (bridge().state.document?.id !== doc.id) return;
    for (const h of heads) {
      const n = headingNumber(h), list = data.articles?.[n] || [];
      const tools = document.createElement('span'); tools.className = 'article-tools';
      tools.innerHTML = (list.length ? '<button type="button" class="article-tool" data-annot="' + esc(n) + '">اجتهاد (' + list.length + ')</button>' : '') + '<button type="button" class="article-tool" data-compare="' + esc(n) + '">قارن</button>';
      h.append(tools);
    }
    body._annotations = data.articles || {};
  }

  function showAnnotations(button) {
    const n = button.dataset.annot, list = button.closest('#readerBody')?._annotations?.[n] || [];
    let box = button.parentElement.nextElementSibling;
    if (box?.classList.contains('article-annotations')) { box.remove(); return; }
    box = document.createElement('div'); box.className = 'article-annotations';
    box.innerHTML = '<p>قرارات أحالت على هذا الفصل (الأحدث أولاً):</p><ul>' + list.map(d => '<li><a href="#" data-open-doc="' + esc(d.id) + '">' + esc(d.title) + '</a></li>').join('') + '</ul>';
    button.parentElement.after(box);
  }

  /* ---------- المقارنة ---------- */
  function words(s) { return String(s).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); }
  function diff(a, b) {
    const A = words(a), B = words(b), n = A.length, m = B.length;
    if (n * m > 4e6) return [{ op: 'del', w: A.join(' ') }, { op: 'add', w: B.join(' ') }];
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (A[i] === B[j]) { out.push({ op: 'eq', w: A[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: 'del', w: A[i++] }); else out.push({ op: 'add', w: B[j++] }); }
    while (i < n) out.push({ op: 'del', w: A[i++] }); while (j < m) out.push({ op: 'add', w: B[j++] });
    return out;
  }
  const render = parts => parts.map(p => p.op === 'eq' ? esc(p.w) : '<' + (p.op === 'add' ? 'ins' : 'del') + '>' + esc(p.w) + '</' + (p.op === 'add' ? 'ins' : 'del') + '>').join(' ');

  function compareDialog() {
    let d = document.getElementById('compareDialog');
    if (d) return d;
    d = document.createElement('dialog'); d.id = 'compareDialog'; d.className = 'compare-dialog';
    d.innerHTML = '<form method="dialog" class="compare-head"><strong>مقارنة نسختين</strong><button class="icon-button" aria-label="إغلاق">×</button></form>' +
      '<div class="compare-pick"><label>النص الآخر <input id="cmpQuery" type="search" placeholder="اكتب اسم القانون، مثل: المسطرة المدنية"></label><select id="cmpDoc"></select><label>رقم الفصل/المادة <input id="cmpN" inputmode="numeric" size="5"></label><button type="button" id="cmpGo" class="primary-button">قارن</button></div>' +
      '<p class="compare-legend"><ins>مضاف</ins> <del>محذوف</del> — النص الأول هو الذي تقرؤه.</p><div id="cmpOut" class="compare-out"></div>';
    document.body.append(d);
    let timer;
    d.querySelector('#cmpQuery').addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => fill(e.target.value), 300); });
    d.querySelector('#cmpGo').addEventListener('click', run);
    return d;
  }
  async function fill(q, preset = []) {
    const sel = document.getElementById('cmpDoc'); const opts = [...preset];
    if (q && q.trim().length > 2) { try { const r = await get('/api/search?scope=legislation&limit=8&q=' + encodeURIComponent(q)); for (const x of r.results || []) if (!opts.some(o => o.id === x.id)) opts.push({ id: x.id, title: x.title }); } catch { /* بلا نتائج */ } }
    sel.innerHTML = opts.map(o => '<option value="' + esc(o.id) + '">' + esc(o.title) + '</option>').join('') || '<option value="">لا نتائج</option>';
  }
  let compareFrom = null;
  async function openCompare(n) {
    const doc = bridge().state.document; if (!doc) return;
    compareFrom = { id: doc.id, n }; const d = compareDialog();
    document.getElementById('cmpN').value = n; document.getElementById('cmpOut').innerHTML = '';
    const preset = [];
    if (doc.supersededBy) preset.push({ id: doc.supersededBy, title: doc.supersededByTitle || 'النص الجديد' });
    if (/58\.25/.test(doc.lawNumber || doc.title || '')) { try { const r = await get('/api/refs/resolve?text=' + encodeURIComponent('الفصل 1 من قانون المسطرة المدنية')); if (r.id && r.id !== doc.id) preset.push({ id: r.id, title: (r.title || 'المسطرة المدنية') + ' (ظهير 1974)' }); } catch { /* تجاهل */ } }
    await fill('', preset); d.showModal();
  }
  async function run() {
    const out = document.getElementById('cmpOut'), other = document.getElementById('cmpDoc').value, n2 = document.getElementById('cmpN').value.trim();
    if (!compareFrom || !other || !n2) { out.textContent = 'اختر النص الآخر ورقم الفصل.'; return; }
    out.textContent = 'جارٍ المقارنة…';
    try {
      const [a, b] = await Promise.all([get('/api/refs/article?doc=' + encodeURIComponent(compareFrom.id) + '&n=' + encodeURIComponent(compareFrom.n)), get('/api/refs/article?doc=' + encodeURIComponent(other) + '&n=' + encodeURIComponent(n2))]);
      if (!a.text || !b.text) { out.textContent = !a.text ? 'لم يُعثر على الفصل في النص الأول.' : 'لم يُعثر على الفصل ' + n2 + ' في النص الآخر.'; return; }
      out.innerHTML = '<div class="compare-cols"><section><h4>' + esc(a.title) + ' — ' + esc(a.n) + '</h4><p>' + esc(a.text) + '</p></section><section><h4>' + esc(b.title) + ' — ' + esc(b.n) + '</h4><p>' + esc(b.text) + '</p></section></div><h4>الفروق</h4><p class="compare-diff">' + render(diff(a.text, b.text)) + '</p>';
    } catch { out.textContent = 'تعذرت المقارنة.'; }
  }

  /* ---------- «أضِف إلى ملف» في منصة قلم ---------- */
  function addToCase() {
    const doc = bridge().state.document; if (!doc) return;
    const quote = String(window.getSelection?.() || '').trim().slice(0, 1500);
    const params = new URLSearchParams({ libraryDoc: doc.id }); if (quote) params.set('quote', quote);
    window.open(OFFICE + '/app/#/cases?' + params.toString(), '_blank', 'noopener');
  }
  function ensureAddButton() {
    const tools = document.querySelector('#reader .reader-header-tools');
    if (!tools || document.getElementById('readerAddToCase')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'readerAddToCase'; b.className = 'icon-button reader-add-case';
    b.title = 'أضِف هذه الوثيقة (أو المقطع المحدد) إلى ملف في مكتبك على منصة قلم'; b.setAttribute('aria-label', b.title); b.textContent = '⊕';
    b.addEventListener('click', addToCase); tools.append(b);
  }

  function process() {
    const body = document.getElementById('readerBody'), doc = bridge()?.state?.document;
    if (!body || !doc || body.dataset.connectedFor === doc.id + ':' + body.childElementCount) return;
    body.dataset.connectedFor = doc.id + ':' + body.childElementCount;
    linkify(body); annotate(body, doc);
  }

  function init() {
    if (!bridge()) return setTimeout(init, 200);
    ensureAddButton();
    const body = document.getElementById('readerBody');
    if (body) new MutationObserver(() => requestAnimationFrame(process)).observe(body, { childList: true });
    document.addEventListener('click', e => {
      const ref = e.target.closest('.ref-link'); if (ref) { e.preventDefault(); openRef(ref.dataset.ref); return; }
      const annot = e.target.closest('[data-annot]'); if (annot) { e.preventDefault(); showAnnotations(annot); return; }
      const cmp = e.target.closest('[data-compare]'); if (cmp) { e.preventDefault(); openCompare(cmp.dataset.compare); return; }
      const open = e.target.closest('[data-open-doc]'); if (open) { e.preventDefault(); bridge().openDocument(open.dataset.openDoc); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
