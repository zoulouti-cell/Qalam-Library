import { createHash, randomBytes } from 'node:crypto';
import { actionButton, paragraphs, renderEmailHtml, renderEmailText, steps } from './email-template.mjs';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailReady = () => Boolean(process.env.BREVO_API_KEY && emailPattern.test(process.env.BREVO_SENDER_EMAIL || ''));
export const ownerEmail = () => String(process.env.LIBRARY_OWNER_EMAIL || '').trim().toLowerCase();
export const validEmail = value => emailPattern.test(String(value || '').trim().toLowerCase());
export const activationToken = () => randomBytes(32).toString('base64url');
export const tokenDigest = value => createHash('sha256').update(String(value)).digest('hex');
export const safeToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function publicBase() {
  const base = String(process.env.LIBRARY_PUBLIC_URL || 'https://qalam-library.onrender.com').replace(/\/+$/, '');
  const parsed = new URL(base);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('رابط المكتبة العام غير آمن.');
  return parsed;
}
export function activationUrl(token) {
  return new URL('/activate?token=' + encodeURIComponent(token), publicBase()).toString();
}
/* رمز الاستعادة يوضع بعد # لا في الاستعلام: لا يصل إلى سجلات الخادم ولا إلى ترويسة Referer. */
export function passwordResetUrl(token) {
  return new URL('/reset-password', publicBase()).toString() + '#token=' + encodeURIComponent(token);
}
export async function sendMail(to, subject, text, html) {
  if (!emailReady()) throw new Error('خدمة البريد غير مهيأة. اضبط BREVO_API_KEY وBREVO_SENDER_EMAIL في Render.');
  /* عنوان بديل لاختبارات الخادم فقط؛ يُتجاهل في الإنتاج فلا يمكن توجيه الرسائل إلى مضيف آخر. */
  const endpoint = process.env.NODE_ENV !== 'production' && process.env.BREVO_API_URL ? process.env.BREVO_API_URL : 'https://api.brevo.com/v3/smtp/email';
  const response = await fetch(endpoint, {
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
export function passwordResetMessage(url) {
  const text = renderEmailText({
    headingAr: 'استعادة كلمة المرور',
    bodyLinesAr: ['وصلنا طلب لاستعادة كلمة مرور حسابكم في المكتبة الرقمية.', 'لتعيين كلمة مرور جديدة افتحوا الرابط التالي خلال 30 دقيقة (يُستعمل مرة واحدة):', url, 'إذا لم تطلبوا ذلك فتجاهلوا هذه الرسالة؛ كلمة مروركم الحالية لم تتغير.'],
    headingFr: 'Réinitialisation du mot de passe',
    bodyLinesFr: ['Nous avons reçu une demande de réinitialisation du mot de passe de votre compte sur la Bibliothèque numérique.', 'Pour définir un nouveau mot de passe, ouvrez le lien suivant dans les 30 minutes (usage unique) :', url, 'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe actuel n’a pas changé.'],
  });
  const html = renderEmailHtml({
    tone: 'warning',
    badgeAr: 'أمان الحساب', badgeFr: 'Sécurité du compte',
    headingAr: 'استعادة كلمة المرور', headingFr: 'Réinitialisation du mot de passe',
    preheader: 'رابط صالح 30 دقيقة لتعيين كلمة مرور جديدة',
    bodyHtmlAr: paragraphs(['وصلنا طلب لاستعادة كلمة مرور حسابكم في المكتبة الرقمية.'])
      + steps(['افتحوا الزر أدناه خلال 30 دقيقة؛ الرابط يُستعمل مرة واحدة.', 'اكتبوا كلمة مرور جديدة من 12 حرفاً على الأقل.', 'ادخلوا إلى المكتبة بكلمة المرور الجديدة.'])
      + actionButton(url, 'تعيين كلمة مرور جديدة')
      + `<p style="margin:14px 0 0;font-size:12px;color:#7a5a1e">إذا لم تطلبوا ذلك فتجاهلوا هذه الرسالة؛ كلمة مروركم الحالية لم تتغير.</p>`,
    bodyHtmlFr: paragraphs(['Nous avons reçu une demande de réinitialisation du mot de passe de votre compte sur la Bibliothèque numérique.'])
      + steps(['Cliquez sur le bouton ci-dessous dans les 30 minutes ; le lien est à usage unique.', 'Saisissez un nouveau mot de passe d’au moins 12 caractères.', 'Connectez-vous à la bibliothèque avec le nouveau mot de passe.'])
      + actionButton(url, 'Définir un nouveau mot de passe')
      + `<p style="margin:14px 0 0;font-size:12px;color:#7a5a1e">Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe actuel n’a pas changé.</p>`,
  });
  return { subject: 'استعادة كلمة المرور — المكتبة الرقمية', text, html };
}
export function passwordChangedMessage() {
  const text = renderEmailText({
    headingAr: 'تم تغيير كلمة المرور',
    bodyLinesAr: ['غُيّرت كلمة مرور حسابكم في المكتبة الرقمية، وأُنهيت الجلسات السابقة.', 'إن لم تكونوا أنتم من فعل ذلك فاطلبوا استعادة كلمة المرور فورًا وراسلوا إدارة المكتبة.'],
    headingFr: 'Mot de passe modifié',
    bodyLinesFr: ['Le mot de passe de votre compte sur la Bibliothèque numérique a été modifié et les sessions précédentes ont été fermées.', 'Si ce n’est pas vous, demandez immédiatement une réinitialisation et contactez l’administration de la bibliothèque.'],
  });
  const html = renderEmailHtml({
    tone: 'info',
    badgeAr: 'أمان الحساب', badgeFr: 'Sécurité du compte',
    headingAr: 'تم تغيير كلمة المرور', headingFr: 'Mot de passe modifié',
    preheader: 'غُيّرت كلمة مرور حسابكم',
    bodyHtmlAr: paragraphs(['غُيّرت كلمة مرور حسابكم في المكتبة الرقمية، وأُنهيت الجلسات السابقة.', 'إن لم تكونوا أنتم من فعل ذلك فاطلبوا استعادة كلمة المرور فورًا وراسلوا إدارة المكتبة.']),
    bodyHtmlFr: paragraphs(['Le mot de passe de votre compte sur la Bibliothèque numérique a été modifié et les sessions précédentes ont été fermées.', 'Si ce n’est pas vous, demandez immédiatement une réinitialisation et contactez l’administration de la bibliothèque.']),
  });
  return { subject: 'تم تغيير كلمة المرور — المكتبة الرقمية', text, html };
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
