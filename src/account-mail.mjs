import { createHash, randomBytes } from 'node:crypto';
import { actionButton, paragraphs, renderEmailHtml, renderEmailText, steps } from './email-template.mjs';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailReady = () => Boolean(process.env.BREVO_API_KEY && emailPattern.test(process.env.BREVO_SENDER_EMAIL || ''));
export const ownerEmail = () => String(process.env.LIBRARY_OWNER_EMAIL || '').trim().toLowerCase();
export const validEmail = value => emailPattern.test(String(value || '').trim().toLowerCase());
export const activationToken = () => randomBytes(32).toString('base64url');
export const tokenDigest = value => createHash('sha256').update(String(value)).digest('hex');
export const safeToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
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
  const text = renderEmailText({
    headingAr: 'مرحباً بك في المكتبة الرقمية',
    bodyLinesAr: ['أنشئ حسابكم في المكتبة الرقمية من منصة قلم بنجاح.', 'لتفعيل الحساب وتعيين كلمة مروركم، افتحوا الرابط التالي خلال 24 ساعة:', url, 'إذا لم تطلبوا إنشاء هذا الحساب فتجاهلوا هذه الرسالة.'],
    headingFr: 'Bienvenue sur la Bibliothèque numérique',
    bodyLinesFr: ['Votre compte sur la Bibliothèque numérique de la plateforme Qalam a été créé avec succès.', 'Pour activer votre compte et définir votre mot de passe, ouvrez le lien suivant dans les 24 heures :', url, 'Si vous n’êtes pas à l’origine de la création de ce compte, ignorez ce message.'],
  });
  const html = renderEmailHtml({
    tone: 'success',
    badgeAr: 'مرحباً بكم', badgeFr: 'Bienvenue',
    headingAr: 'مرحباً بك في المكتبة الرقمية', headingFr: 'Bienvenue sur la Bibliothèque numérique',
    preheader: 'فعّلوا حسابكم خلال 24 ساعة',
    bodyHtmlAr: paragraphs(['أنشئ حسابكم في المكتبة الرقمية من منصة قلم بنجاح.'])
      + steps(['افتحوا زر التفعيل أدناه خلال 24 ساعة.', 'عيّنوا كلمة مروركم.', 'ادخلوا إلى المكتبة الرقمية بحسابكم الجديد فورًا.'])
      + actionButton(url, 'تفعيل الحساب')
      + `<p style="margin:14px 0 0;font-size:12px;color:#7a5a1e">إذا لم تطلبوا إنشاء هذا الحساب فتجاهلوا هذه الرسالة.</p>`,
    bodyHtmlFr: paragraphs(['Votre compte sur la Bibliothèque numérique de la plateforme Qalam a été créé avec succès.'])
      + steps(['Cliquez sur le bouton d’activation ci-dessous dans les 24 heures.', 'Définissez votre mot de passe.', 'Connectez-vous immédiatement avec votre nouveau compte.'])
      + actionButton(url, 'Activer le compte')
      + `<p style="margin:14px 0 0;font-size:12px;color:#7a5a1e">Si vous n’êtes pas à l’origine de la création de ce compte, ignorez ce message.</p>`,
  });
  return {
    subject: 'مرحباً بك في المكتبة الرقمية — فعّل حسابك',
    text,
    html,
  };
}
export async function notifyOwner(event, email, recipient = ownerEmail()) {
  const owner = String(recipient || '').trim().toLowerCase();
  if (!validEmail(owner)) return false;
  const activated = event === 'activated';
  const labelAr = activated ? 'تفعيل حساب' : 'محاولة تسجيل حساب';
  const labelFr = activated ? 'Activation d’un compte' : 'Tentative d’inscription';
  const when = new Date().toISOString();
  const text = renderEmailText({
    headingAr: `${labelAr} — المكتبة الرقمية`,
    bodyLinesAr: [`البريد الإلكتروني: ${email}`, `الوقت: ${when}`],
    headingFr: `${labelFr} — Bibliothèque numérique`,
    bodyLinesFr: [`E-mail : ${email}`, `Heure : ${when}`],
  });
  const html = renderEmailHtml({
    tone: activated ? 'success' : 'info',
    badgeAr: 'إشعار للإدارة', badgeFr: 'Notification administrative',
    headingAr: labelAr, headingFr: labelFr,
    preheader: email,
    bodyHtmlAr: paragraphs([`البريد الإلكتروني: ${email}`, `الوقت: ${when}`]),
    bodyHtmlFr: paragraphs([`E-mail : ${email}`, `Heure : ${when}`]),
  });
  await sendMail(owner, `${labelAr} — المكتبة الرقمية`, text, html);
  return true;
}
