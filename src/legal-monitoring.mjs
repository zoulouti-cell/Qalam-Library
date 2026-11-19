import { createHash } from 'node:crypto';

export const REPORTS = Object.freeze({
  monday: { hour: 7, weekday: 1, hours: 72, title: 'تقرير الاثنين: مستجدات المغرب وفرنسا' },
  wednesday: { hour: 7, weekday: 3, hours: 48, title: 'تقرير الأربعاء: مستجدات المغرب وفرنسا' },
  saturday: { hour: 8, weekday: 6, hours: 168, title: 'التقرير الأسبوعي الشامل وتحيين المكتبة', publishesLibrary: true },
});
export const REPORT_TIME_ZONE = 'Africa/Casablanca';
/* مهلة الاعتراض: يبقى المستجد «جاهزاً» أربعاً وعشرين ساعة، فإن لم يُتحفَّظ عليه نُشر. */
export const PUBLICATION_DELAY_MS = 24 * 60 * 60 * 1000;
export const STAGES = Object.freeze(['project', 'study', 'approved', 'issued', 'published', 'effective']);
export const STATES = Object.freeze(['discovered', 'verifying', 'held', 'ready', 'published']);
const stageRank = stage => Math.max(0, STAGES.indexOf(stage));

const oneLine = (value, max = 500) => String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const isoDate = value => {
  const raw = oneLine(value, 20);
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};
const sourceUrl = value => {
  try { const u = new URL(String(value || '')); return u.protocol === 'https:' ? u.toString() : ''; }
  catch { return ''; }
};

export function officialSource(source = {}) {
  const url = sourceUrl(source.url);
  const host = url ? new URL(url).hostname.toLowerCase() : '';
  return !!url && source.verified === true && oneLine(source.label, 200).length >= 3 &&
    source.official === true && !!host && !host.includes('..');
}

/* العنوان الفرنسي الخام (دون حرف عربي) لا يُنشر تلقائياً: يلزم تعريبه أو تعديله من المدير. */
export const titleNeedsArabic = (record = {}) => record.country === 'fr' && !!record.title && !/[\u0600-\u06FF]/.test(String(record.title));

export function makeObservation(input = {}) {
  const country = ['ma', 'fr'].includes(input.country) ? input.country : '';
  const kind = ['legislation', 'bill', 'case_law', 'research', 'justice_digital'].includes(input.kind) ? input.kind : '';
  const source = { url: sourceUrl(input.source?.url), label: oneLine(input.source?.label, 200), official: input.source?.official === true, verified: input.source?.verified === true };
  const title = oneLine(input.title, 500), summary = String(input.summary ?? '').trim().slice(0, 20000);
  const eventDate = isoDate(input.eventDate), receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  if (!country || !kind || title.length < 3 || summary.length < 40 || !eventDate || Number.isNaN(receivedAt.getTime()) || !officialSource(source)) return { error: 'الملاحظة ناقصة أو مصدرها الرسمي غير متحقق منه.' };
  const reference = oneLine(input.reference, 300), court = oneLine(input.court, 200), caseNumber = oneLine(input.caseNumber, 120);
  // مشروع القانون والقانون المنشور مرحلتان للسجل التشريعي نفسه. نعتمد مرجعاً
  // رسمياً ثابتاً كي لا تنشئ كل متابعة بطاقة جديدة عند الاعتماد أو النشر أو النفاذ.
  const legislative = kind === 'legislation' || kind === 'bill';
  const stableReference = oneLine(input.officialNumber, 150) || reference || title.toLocaleLowerCase();
  const key = legislative
    ? [country, 'legislation', stableReference.toLocaleLowerCase()].join('|')
    : [country, kind, oneLine(input.officialNumber, 150), eventDate, title.toLocaleLowerCase()].join('|');
  const id = createHash('sha256').update(key).digest('hex');
  const restrictedCassation = country === 'ma' && kind === 'case_law' && /محكمة\s+النقض/.test(court);
  const hasReservation = input.legalReservation === true || input.scientificReservation === true || input.technicalReservation === true;
  const publishableKind = ['research', 'case_law', 'bill', 'legislation'].includes(kind);
  const untranslated = titleNeedsArabic({ country, title });
  const readyForAutomaticPublication = source.verified && input.complete === true && !hasReservation && publishableKind && !restrictedCassation && !untranslated;
  return { record: {
    id, country, kind, title, originalTitle: oneLine(input.originalTitle, 500), summary, eventDate, receivedAt, source, reference, court, caseNumber,
    officialNumber: oneLine(input.officialNumber, 150), currentStage: STAGES.includes(input.currentStage) ? input.currentStage : '',
    state: readyForAutomaticPublication ? 'ready' : 'held',
    effectiveDate: isoDate(input.effectiveDate), autoPublishAt: readyForAutomaticPublication && !(country === 'ma' && legislative) ? new Date(receivedAt.getTime() + PUBLICATION_DELAY_MS) : null, /* القوانين المغربية ومشاريعها وقرارات النقض المغربية باعتماد المدير يدوياً؛ وما عداها يُنشر تلقائياً بعد 24 ساعة */
    holdReason: restrictedCassation ? 'قرار محكمة النقض المغربية يتطلب اعتماد المدير حصراً.' : hasReservation ? 'توجد ملاحظة قانونية أو علمية أو تقنية تستلزم المراجعة.' : untranslated ? 'العنوان غير معرَّب؛ اكتب عنواناً عربياً قبل الاعتماد.' : !input.complete ? 'بيانات الإضافة أو التحقق غير مكتملة.' : !publishableKind ? 'هذا النوع لا ينشر تلقائياً؛ يلزم اعتماد المدير.' : '',
    readyForAutomaticPublication, original: input.original && typeof input.original === 'object' ? { driveId: oneLine(input.original.driveId, 200), url: sourceUrl(input.original.url), name: oneLine(input.original.name, 300) } : null,
    history: [{ state: readyForAutomaticPublication ? 'ready' : 'held', at: receivedAt, reason: restrictedCassation ? 'manager_approval_required' : hasReservation ? 'reservation' : 'verification_incomplete' }],
  } };
}

/**
 * يدمج متابعة لاحقة في السجل التشريعي نفسه. لا يسمح لدليل متأخر أو أضعف
 * بإرجاع حالة منشورة/نافذة إلى «مشروع»، ويحتفظ بسجل المراحل القابل للمراجعة.
 */
export function mergeLegislativeObservation(existing = null, incoming = {}) {
  if (!existing) return incoming;
  const prior = STAGES.includes(existing.currentStage) ? existing.currentStage : '';
  const next = STAGES.includes(incoming.currentStage) ? incoming.currentStage : prior;
  const currentStage = prior && stageRank(next) < stageRank(prior) ? prior : next;
  const changed = currentStage !== prior || incoming.source?.url !== existing.source?.url || incoming.eventDate !== existing.eventDate;
  const history = Array.isArray(existing.history) ? [...existing.history] : [];
  if (changed) history.push({ state: incoming.state || existing.state || 'held', stage: currentStage, at: incoming.receivedAt || new Date(), reason: 'official_follow_up', source: incoming.source?.url || existing.source?.url || '' });
  return { ...existing, ...incoming, kind: currentStage === 'published' || currentStage === 'effective' ? 'legislation' : incoming.kind, currentStage, history };
}

export function mayAutoPublish(record = {}) {
  if (titleNeedsArabic(record)) return false;
  /* الاعتماد اليدوي وحده: قرارات محكمة النقض المغربية والقوانين المغربية ومشاريعها والرقمنة القضائية.
     القسم الفرنسي والمحكمة الدستورية وسائر المستجدات تُنشر تلقائياً بعد 24 ساعة (ونص فرنسي تشريعي لا يُنشر قبل استيفاء مراحله). */
  return record.state === 'ready' && record.readyForAutomaticPublication === true &&
    record.source?.official === true && record.source?.verified === true &&
    !(record.country === 'ma' && record.kind === 'case_law' && /محكمة\s+النقض/.test(record.court || '')) &&
    !(record.country === 'ma' && ['legislation', 'bill'].includes(record.kind)) &&
    record.kind !== 'justice_digital' &&
    (record.kind !== 'legislation' || ['published', 'effective'].includes(record.currentStage));
}

/* هل يصلح السجل للنشر التلقائي لو رُفع عنه التحفظ؟ (القوانين المغربية ومشاريعها وقرارات النقض المغربية والرقمنة القضائية لا تُنشر إلا باعتماد المدير). */
export const canAutoPublishAfterRelease = (record = {}) => mayAutoPublish({ ...record, state: 'ready', readyForAutomaticPublication: true });

/* موعد النشر التلقائي بعد رفع التحفظ: 24 ساعة لما يجوز نشره تلقائياً، وإلا null فيبقى بانتظار اعتماد المدير. */
export const scheduleAfterRelease = (record = {}, now = new Date()) => canAutoPublishAfterRelease(record) ? new Date(now.getTime() + PUBLICATION_DELAY_MS) : null;

/* النص التشريعي لا يُعتمد للنشر قبل استيفاء مراحله: النشر في الجريدة الرسمية أو النفاذ. */
export function lawStagesComplete(record = {}) {
  return !['legislation', 'bill'].includes(record.kind) || ['published', 'effective'].includes(record.currentStage);
}

function partsAt(date, timeZone = REPORT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Returns due report slots in local Morocco time; callers persist a unique (type, localDate) key.
export function dueReports(now = new Date()) {
  const p = partsAt(now), minute = Number(p.minute), hour = Number(p.hour), weekday = WEEKDAYS[p.weekday];
  const localDate = `${p.year}-${p.month}-${p.day}`;
  return Object.entries(REPORTS).filter(([, spec]) => (hour > spec.hour || (hour === spec.hour && minute >= 0)) && (spec.weekday === null || weekday === spec.weekday))
    .map(([type]) => ({ type, localDate, dueAt: new Date(now) }));
}

export function renderReport(type, records, { localDate, generatedAt = new Date() } = {}) {
  const config = REPORTS[type];
  if (!config) throw new TypeError('Unknown report type');
  const list = [...(records || [])].filter(r => r && r.source?.verified === true && r.source?.official === true);
  const lines = [config.title, `تاريخ الإصدار: ${localDate || generatedAt.toISOString()}`, 'النطاق: المغرب وفرنسا', 'المنطقة الزمنية: Africa/Casablanca', ''];
  for (const country of ['ma', 'fr']) {
    lines.push(country === 'ma' ? 'المغرب' : 'فرنسا');
    const items = list.filter(r => r.country === country);
    if (!items.length) lines.push('لا توجد مستجدات رسمية متحققة مسجلة للفترة.');
    for (const item of items) lines.push(`- ${item.title} | التاريخ: ${item.eventDate} | الحالة: ${item.currentStage || item.state} | المصدر: ${item.source.label} (${item.source.url})${item.holdReason ? ` | ملاحظة: ${item.holdReason}` : ''}`);
    lines.push('');
  }
  lines.push('هذا التقرير يلخص السجلات الرسمية المتحققة المحفوظة في النظام؛ لا يمثل غياب سجل دليلاً على عدم صدور مستجد.');
  return lines.join('\n');
}

/* الفئة التي ينشر فيها المستجد بحسب البلد ونوعه والجهة. */
export function publicationCategory(record = {}) {
  const chosen = String(record.publishCategory || '').trim();
  if (chosen) return chosen.slice(0, 80);
  if (record.country === 'ma' && record.kind === 'case_law' && /محكمة\s+النقض/.test(String(record.court || ''))) return 'إضافات النقض';
  const court = String(record.court || '');
  if (record.kind === 'case_law') {
    if (record.country === 'ma') return /المحكمة\s+الدستورية|المجلس\s+الدستوري/.test(court) ? 'القضاء الدستوري' : 'مستجدات';
    if (/Conseil\s+constitutionnel|المجلس\s+الدستوري/i.test(court)) return 'المجلس الدستوري الفرنسي';
    if (/Conseil\s+d.État|مجلس\s+الدولة/i.test(court)) return 'مجلس الدولة الفرنسي';
    return 'محكمة النقض الفرنسية';
  }
  if (record.kind === 'research') return record.country === 'fr' ? 'دراسات فرنسية' : 'مستجدات';
  return record.country === 'fr' ? 'مستجدات فرنسية' : 'مستجدات';
}

const STAGE_LABELS = { project: 'مشروع', study: 'قيد الدراسة', approved: 'مصادق عليه', issued: 'صدر الأمر بتنفيذه', published: 'نُشر في الجريدة الرسمية', effective: 'نافذ' };
export const stageLabel = stage => STAGE_LABELS[stage] || '';

/* سجل المحتوى المنشور الذي تعرضه المكتبة في نافذة الاطلاع. */
export function publicationRecord(item = {}, now = new Date()) {
  const stage = stageLabel(item.currentStage);
  const header = [
    stage ? `المرحلة: ${stage}.` : '',
    item.effectiveDate ? `تاريخ النفاذ: ${item.effectiveDate}.` : '',
    `التاريخ: ${item.eventDate}.`,
    `المصدر: ${item.source?.label || ''}.`,
  ].filter(Boolean).join('\n');
  const original = item.original?.driveId ? [{ id: `${item.id.slice(0, 12)}-original`, name: item.original.name || 'الأصل', ext: /\.(\w{2,4})$/.exec(item.original.name || '')?.[1]?.toLowerCase() || 'pdf', size: 0, driveId: item.original.driveId }] : [];
  return {
    documentId: `monitor-${item.id.slice(0, 20)}`, status: 'published', country: item.country,
    title: item.title, originalTitle: item.originalTitle || '', sourceLanguage: item.country === 'fr' ? 'fr' : 'ar', professionalArabicReviewed: false,
    type: item.kind === 'case_law' ? 'judicial' : 'national', kind: item.kind === 'case_law' ? 'decision' : item.kind === 'research' ? 'study' : item.kind === 'legislation' ? 'law' : 'other',
    category: publicationCategory(item), subcategory: stage ? `${stage}` : '', date: item.eventDate,
    textKind: 'source_summary', reviewStatus: 'needs_review',
    sourceLabel: item.source?.label || '', sourceUrl: item.source?.url || '',
    text: `${header}\n\n${item.summary}`, originalFiles: original, origin: 'legal-monitor', monitorItemId: item.id,
    createdAt: now, updatedAt: now,
  };
}

/* مستجدات نفذت اليوم أو ينفذ قانونها اليوم: تُعرض تنبيهاً ليوم واحد. */
export function effectiveToday(items = [], today = '') {
  return (items || []).filter(i => i.state === 'published' && i.effectiveDate === today).map(i => ({ id: i.id, title: i.title, country: i.country, documentId: `monitor-${i.id.slice(0, 20)}`, effectiveDate: i.effectiveDate }));
}

/* المستجدات المنشورة خلال الأيام الأخيرة (أسبوع على الأكثر) لشريط المستجدات؛ يختفي الشريط إن لم توجد. */
/* شريط الأخبار: مشاريع القوانين والمقترحات وأخبار المجالس والبرلمان والرقمنة القضائية؛ النقر عليها يفتح الرابط الرسمي.
   أما القرارات والقوانين والمستجدات فلكلٍّ قسمها بعنوانه، ولا تظهر في الشريط. */
export const TICKER_KINDS = Object.freeze(['bill', 'justice_digital']);
export const isTickerItem = item => TICKER_KINDS.includes(item?.kind);
export function tickerItems(items = [], now = new Date(), days = 14) {
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  return (items || [])
    .filter(i => isTickerItem(i) && i.state === 'published' && i.publishedAt && new Date(i.publishedAt).getTime() >= since && /^https?:\/\//i.test(i.source?.url || ''))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .map(i => ({ id: i.id, title: i.title, country: i.country, kind: i.kind, url: i.source.url, eventDate: i.eventDate, publishedAt: i.publishedAt }));
}

export function recentUpdates(items = [], now = new Date(), days = 7) {
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  return (items || [])
    .filter(i => !isTickerItem(i) && i.state === 'published' && i.publishedAt && new Date(i.publishedAt).getTime() >= since)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .map(i => ({ id: i.id, title: i.title, country: i.country, kind: i.kind, stage: stageLabel(i.currentStage), eventDate: i.eventDate, publishedAt: i.publishedAt, documentId: `monitor-${String(i.id).slice(0, 20)}` }));
}
