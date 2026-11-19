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
/* رابط تأكيد بريد التسجيل: الرمز بعد # فلا يصل إلى سجلات الخادم ولا إلى ترويسة Referer. */
export function registrationConfirmUrl(token) {
  return new URL('/confirm-registration', publicBase()).toString() + '#token=' + encodeURIComponent(token);
}
export function libraryLoginUrl() {
  return new URL('/login', publicBase()).toString();
}
export function adminRequestsUrl() {
  return new URL('/admin', publicBase()).toString();
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
export function registrationConfirmMessage(url) {
  const text = renderEmailText({
    headingAr: 'تأكيد بريدكم الإلكتروني',
    bodyLinesAr: ['السلام عليكم،', 'وصلنا طلب تسجيلكم في المكتبة الرقمية. لتأكيد بريدكم الإلكتروني افتحوا الرابط الآتي خلال 24 ساعة:', url, 'بعد التأكيد يُعرض طلبكم على إدارة المنصة، وتُعلمكم بقرارها بالبريد الإلكتروني. وإن لم تطلبوا هذا التسجيل فتجاهلوا الرسالة.'],
    headingFr: 'Confirmation de votre adresse e-mail',
    bodyLinesFr: ['Bonjour,', 'Nous avons reçu votre demande d’inscription à la Bibliothèque numérique. Pour confirmer votre adresse e-mail, ouvrez le lien suivant dans les 24 heures :', url, 'Après confirmation, votre demande est soumise à l’administration de la plateforme, qui vous informera de sa décision par e-mail. Si vous n’êtes pas à l’origine de cette inscription, ignorez ce message.'],
  });
  const html = renderEmailHtml({
    tone: 'info',
    badgeAr: 'تسجيل جديد', badgeFr: 'Nouvelle inscription',
    headingAr: 'تأكيد بريدكم الإلكتروني', headingFr: 'Confirmation de votre adresse e-mail',
    preheader: 'أكّدوا بريدكم خلال 24 ساعة',
    bodyHtmlAr: paragraphs(['السلام عليكم،', 'وصلنا طلب تسجيلكم في المكتبة الرقمية. لتأكيد بريدكم الإلكتروني افتحوا الزر أدناه خلال 24 ساعة.', 'بعد التأكيد يُعرض طلبكم على إدارة المنصة، وتُعلمكم بقرارها بالبريد الإلكتروني.'])
      + actionButton(url, 'تأكيد البريد الإلكتروني')
      + `<p style="margin:14px 0 0;font-size:12px;color:#7a5a1e">إن لم تطلبوا هذا التسجيل فتجاهلوا الرسالة.</p>`,
    bodyHtmlFr: paragraphs(['Bonjour,', 'Nous avons reçu votre demande d’inscription à la Bibliothèque numérique. Pour confirmer votre adresse e-mail, cliquez sur le bouton ci-dessous dans les 24 heures.', 'Après confirmation, votre demande est soumise à l’administration de la plateforme, qui vous informera de sa décision par e-mail.'])
      + actionButton(url, 'Confirmer l’adresse e-mail')
      + `<p style="margin:14px 0 0;font-size:12px;color:#7a5a1e">Si vous n’êtes pas à l’origine de cette inscription, ignorez ce message.</p>`,
  });
  return { subject: 'تأكيد بريدكم الإلكتروني — المكتبة الرقمية', text, html };
}
export function registrationApprovedMessage(role = 'reader') {
  const url = libraryLoginUrl().replace(/\/login$/, '/');
  const admin = role === 'admin';
  const adminAr = admin ? 'وقد مُنحتم صلاحية الإدارة.' : '';
  const adminFr = admin ? 'Les droits d’administration vous ont été accordés.' : '';
  const intro = ['السلام عليكم،', 'يسعدنا إخباركم بأنه تمت الموافقة على طلبكم، وأصبح حسابكم في مكتبة قلم الرقمية مفعَّلاً. أهلاً وسهلاً بكم.', adminAr];
  const introFr = ['Bonjour,', 'Nous avons le plaisir de vous informer que votre demande a été acceptée : votre compte sur la Bibliothèque numérique Qalam est désormais activé. Soyez les bienvenus.', adminFr];
  const how = 'للدخول، افتحوا الرابط الآتي واستعملوا بريدكم وكلمة المرور التي اخترتموها عند التسجيل:';
  const howFr = 'Pour vous connecter, ouvrez le lien ci-dessous avec l’adresse e-mail et le mot de passe choisis lors de votre inscription :';
  const helpAr = 'وإن كان لديكم أي استفسار أو ملاحظة، فيسعدنا تواصلكم مع إدارة المنصة.';
  const helpFr = 'Pour toute question ou remarque, n’hésitez pas à contacter l’administration de la plateforme.';
  const wishAr = 'منصة قلم تتمنى لكم جولة مفيدة وممتعة بين رفوفها.';
  const wishFr = 'La plateforme Qalam vous souhaite une visite utile et agréable entre ses rayons.';
  const text = renderEmailText({
    headingAr: 'مرحباً بكم في مكتبة قلم الرقمية',
    bodyLinesAr: [...intro, how, url, helpAr, wishAr, 'منصة قلم — المكتبة الرقمية'],
    headingFr: 'Bienvenue à la Bibliothèque numérique Qalam',
    bodyLinesFr: [...introFr, howFr, url, helpFr, wishFr, 'Plateforme Qalam — Bibliothèque numérique'],
  });
  const html = renderEmailHtml({
    tone: 'success',
    badgeAr: 'تمت الموافقة', badgeFr: 'Demande acceptée',
    headingAr: 'مرحباً بكم في مكتبة قلم الرقمية', headingFr: 'Bienvenue à la Bibliothèque numérique Qalam',
    preheader: 'تمت الموافقة على طلبكم، وحسابكم مفعَّل',
    bodyHtmlAr: paragraphs([...intro, how]) + actionButton(url, 'الدخول إلى المكتبة') + `<div style="height:12px"></div>` + paragraphs([helpAr, wishAr]) + `<p style="margin:12px 0 0;font-size:13.5px;font-weight:700;color:#163428">منصة قلم<br><span style="font-weight:400">المكتبة الرقمية</span></p>`,
    bodyHtmlFr: paragraphs([...introFr, howFr]) + actionButton(url, 'Accéder à la bibliothèque') + `<div style="height:12px"></div>` + paragraphs([helpFr, wishFr]) + `<p style="margin:12px 0 0;font-size:13.5px;font-weight:700;color:#163428">Plateforme Qalam<br><span style="font-weight:400">Bibliothèque numérique</span></p>`,
  });
  return { subject: 'مرحباً بكم في مكتبة قلم الرقمية — Bienvenue à la Bibliothèque numérique Qalam', text, html };
}
export function registrationRejectedMessage() {
  const ar = ['السلام عليكم،', 'نشكركم على اهتمامكم بمكتبة قلم الرقمية وعلى ثقتكم بها.', 'نأسف لإبلاغكم بأنه تعذّر قبول طلب تسجيلكم في الوقت الحالي. وللاستفسار عن ذلك، نرجو منكم الاتصال بإدارة المنصة.', 'مع خالص التحية والتقدير.'];
  const fr = ['Bonjour,', 'Nous vous remercions de l’intérêt que vous portez à la Bibliothèque numérique Qalam.', 'Nous regrettons de vous informer que votre demande d’inscription n’a pu être acceptée pour le moment. Pour toute précision, nous vous invitons à contacter l’administration de la plateforme.', 'Cordialement,'];
  const text = renderEmailText({
    headingAr: 'بشأن طلب التسجيل', bodyLinesAr: [...ar, 'منصة قلم — المكتبة الرقمية'],
    headingFr: 'À propos de votre demande d’inscription', bodyLinesFr: [...fr, 'Plateforme Qalam — Bibliothèque numérique'],
  });
  const html = renderEmailHtml({
    tone: 'neutral',
    badgeAr: 'طلب التسجيل', badgeFr: 'Demande d’inscription',
    headingAr: 'بشأن طلب التسجيل', headingFr: 'À propos de votre demande d’inscription',
    preheader: 'بشأن طلب تسجيلكم في مكتبة قلم',
    bodyHtmlAr: paragraphs(ar) + `<p style="margin:12px 0 0;font-size:13.5px;font-weight:700;color:#163428">منصة قلم<br><span style="font-weight:400">المكتبة الرقمية</span></p>`,
    bodyHtmlFr: paragraphs(fr) + `<p style="margin:12px 0 0;font-size:13.5px;font-weight:700;color:#163428">Plateforme Qalam<br><span style="font-weight:400">Bibliothèque numérique</span></p>`,
  });
  return { subject: 'بشأن طلب التسجيل في مكتبة قلم — Votre demande d’inscription à Qalam', text, html };
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
  const review = event === 'review';
  const activated = event === 'activated';
  const labelAr = review ? 'طلب تسجيل بانتظار قرارك' : activated ? 'تفعيل حساب' : 'محاولة تسجيل حساب';
  const labelFr = review ? 'Demande d’inscription en attente de décision' : activated ? 'Activation d’un compte' : 'Tentative d’inscription';
  const when = new Date().toISOString();
  const text = renderEmailText({
    headingAr: `${labelAr} — المكتبة الرقمية`,
    bodyLinesAr: [`البريد الإلكتروني: ${email}`, `الوقت: ${when}`, ...(review ? [`للبتّ فيه (قارئ / مدير / رفض): ${adminRequestsUrl()}`] : [])],
    headingFr: `${labelFr} — Bibliothèque numérique`,
    bodyLinesFr: [`E-mail : ${email}`, `Heure : ${when}`, ...(review ? [`Pour décider (lecteur / administrateur / refus) : ${adminRequestsUrl()}`] : [])],
  });
  const html = renderEmailHtml({
    tone: activated ? 'success' : 'info',
    badgeAr: 'إشعار للإدارة', badgeFr: 'Notification administrative',
    headingAr: labelAr, headingFr: labelFr,
    preheader: email,
    bodyHtmlAr: paragraphs([`البريد الإلكتروني: ${email}`, `الوقت: ${when}`]) + (review ? actionButton(adminRequestsUrl(), 'فتح لوحة الإدارة') : ''),
    bodyHtmlFr: paragraphs([`E-mail : ${email}`, `Heure : ${when}`]) + (review ? actionButton(adminRequestsUrl(), 'Ouvrir l’administration') : ''),
  });
  await sendMail(owner, `${labelAr} — المكتبة الرقمية`, text, html);
  return true;
}
