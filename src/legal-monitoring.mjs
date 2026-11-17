import { createHash } from 'node:crypto';

export const REPORTS = Object.freeze({
  daily: { hour: 7, weekday: null, title: 'التقرير اليومي للمستجدات القانونية والقضائية' },
  weekly: { hour: 8, weekday: 6, title: 'التقرير الأسبوعي الشامل' },
  justice: { hour: 8, weekday: 1, title: 'تقرير رقمنة العدالة وتطوير قلم' },
});
export const REPORT_TIME_ZONE = 'Africa/Casablanca';
export const STAGES = Object.freeze(['project', 'study', 'approved', 'issued', 'published', 'effective']);
export const STATES = Object.freeze(['discovered', 'verifying', 'held', 'ready', 'published']);

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

export function makeObservation(input = {}) {
  const country = ['ma', 'fr'].includes(input.country) ? input.country : '';
  const kind = ['legislation', 'bill', 'case_law', 'research', 'justice_digital'].includes(input.kind) ? input.kind : '';
  const source = { url: sourceUrl(input.source?.url), label: oneLine(input.source?.label, 200), official: input.source?.official === true, verified: input.source?.verified === true };
  const title = oneLine(input.title, 500), summary = String(input.summary ?? '').trim().slice(0, 20000);
  const eventDate = isoDate(input.eventDate), receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  if (!country || !kind || title.length < 3 || summary.length < 40 || !eventDate || Number.isNaN(receivedAt.getTime()) || !officialSource(source)) return { error: 'الملاحظة ناقصة أو مصدرها الرسمي غير متحقق منه.' };
  const reference = oneLine(input.reference, 300), court = oneLine(input.court, 200), caseNumber = oneLine(input.caseNumber, 120);
  const key = [country, kind, oneLine(input.officialNumber, 150), eventDate, title.toLocaleLowerCase()].join('|');
  const id = createHash('sha256').update(key).digest('hex');
  const restrictedCassation = country === 'ma' && kind === 'case_law' && /محكمة\s+النقض/.test(court);
  const hasReservation = input.legalReservation === true || input.scientificReservation === true || input.technicalReservation === true;
  const publishableKind = ['research', 'case_law', 'bill'].includes(kind);
  const readyForAutomaticPublication = source.verified && input.complete === true && !hasReservation && publishableKind && !restrictedCassation;
  return { record: {
    id, country, kind, title, summary, eventDate, receivedAt, source, reference, court, caseNumber,
    officialNumber: oneLine(input.officialNumber, 150), currentStage: STAGES.includes(input.currentStage) ? input.currentStage : '',
    state: readyForAutomaticPublication ? 'ready' : 'held',
    holdReason: restrictedCassation ? 'قرار محكمة النقض المغربية يتطلب اعتماد المدير حصراً.' : hasReservation ? 'توجد ملاحظة قانونية أو علمية أو تقنية تستلزم المراجعة.' : !input.complete ? 'بيانات الإضافة أو التحقق غير مكتملة.' : !publishableKind ? 'هذا النوع لا ينشر تلقائياً؛ يلزم اعتماد المدير.' : '',
    readyForAutomaticPublication, original: input.original && typeof input.original === 'object' ? { driveId: oneLine(input.original.driveId, 200), url: sourceUrl(input.original.url), name: oneLine(input.original.name, 300) } : null,
    history: [{ state: readyForAutomaticPublication ? 'ready' : 'held', at: receivedAt, reason: restrictedCassation ? 'manager_approval_required' : hasReservation ? 'reservation' : 'verification_incomplete' }],
  } };
}

export function mayAutoPublish(record = {}) {
  return record.state === 'ready' && record.readyForAutomaticPublication === true &&
    record.source?.official === true && record.source?.verified === true &&
    !(record.country === 'ma' && record.kind === 'case_law' && /محكمة\s+النقض/.test(record.court || '')) &&
    record.kind !== 'legislation' && record.kind !== 'justice_digital';
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
