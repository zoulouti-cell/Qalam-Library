import { createHash, randomBytes } from 'node:crypto';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailReady = () => Boolean(process.env.BREVO_API_KEY && emailPattern.test(process.env.BREVO_SENDER_EMAIL || ''));
export const ownerEmail = () => String(process.env.LIBRARY_OWNER_EMAIL || '').trim().toLowerCase();
export const validEmail = value => emailPattern.test(String(value || '').trim().toLowerCase());
export const activationToken = () => randomBytes(32).toString('base64url');
export const tokenDigest = value => createHash('sha256').update(String(value)).digest('hex');
export const safeToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function activationUrl(token) {
  const base = String(process.env.LIBRARY_PUBLIC_URL || 'https://qalam-library.onrender.com').replace(/\/+$/, '');
  const parsed = new URL(base);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('رابط المكتبة العام غير آمن.');
  return new URL('/activate?token=' + encodeURIComponent(token), parsed).toString();
}
export async function sendMail(to, subject, text, html) {
  if (!emailReady()) throw new Error('خدمة البريد غير مهيأة. اضبط BREVO_API_KEY وBREVO_SENDER_EMAIL في Render.');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': process.env.BREVO_API_KEY },
    body: JSON.stringify({ sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || 'المكتبة الرقمية · قلم' }, to: [{ email: to }], subject, ...(html ? { htmlContent: html } : { textContent: text }) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    console.error('Brevo delivery failed:', response.status);
    throw new Error('تعذر إرسال رسالة البريد. تحقق من مفتاح Brevo وعنوان المرسل المعتمد.');
  }
  return true;
}
export function activationMessage(url) {
  const safe = escapeHtml(url);
  return {
    subject: 'مرحباً بك في المكتبة الرقمية — فعّل حسابك',
    text: `مرحباً بك في المكتبة الرقمية من قلم. لتفعيل حسابك وتعيين كلمة مرورك، افتح الرابط التالي خلال 24 ساعة:\n${url}\nإذا لم تطلب إنشاء الحساب فتجاهل هذه الرسالة.`,
    html: `<div dir="rtl" lang="ar" style="font-family:Tahoma,Arial,sans-serif;color:#143e34;line-height:1.9"><h2>مرحباً بك في المكتبة الرقمية</h2><p>لتفعيل حسابك وتعيين كلمة مرورك، اضغط على الزر التالي خلال 24 ساعة.</p><p><a href="${safe}" style="display:inline-block;background:#143e34;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">تفعيل الحساب</a></p><p>إذا لم تطلب إنشاء الحساب فتجاهل هذه الرسالة.</p></div>`,
  };
}
export async function notifyOwner(event, email) {
  const owner = ownerEmail();
  if (!validEmail(owner)) return false;
  const label = event === 'activated' ? 'تفعيل حساب' : 'محاولة تسجيل حساب';
  await sendMail(owner, `${label} — المكتبة الرقمية`, `${label} في المكتبة الرقمية\nالبريد الإلكتروني: ${email}\nالوقت: ${new Date().toISOString()}`, `<div dir="rtl" lang="ar" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8"><h2>${label}</h2><p>البريد الإلكتروني: ${escapeHtml(email)}</p><p>الوقت: ${escapeHtml(new Date().toISOString())}</p></div>`);
  return true;
}
