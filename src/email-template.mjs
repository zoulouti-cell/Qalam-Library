// قالب بريد موحّد لمنصة قلم: مزدوج اللغة (عربي أولاً ثم فرنسي)، بهوية المنصة البصرية
// (الشعار وتدرّجات الأخضر الغابي والذهبي)، وبتوقيع مزخرف باسم المبرمج ZOULOUTI/الزلوطي.
// نسخة مطابقة لقالب مكتب قلم (qalam-app/email-template.mjs) حتى تبقى رسائل المنصة بهوية واحدة.
//
// ألوان الواجهة مثبّتة بصريحة (bgcolor + استعلام color-scheme) حتى لا يعكسها الوضع الداكن
// في تطبيقات البريد على الهاتف، فيبقى الشعار والنصوص مقروءة كما صُمِّمت لا كما يفرضها الجهاز.

const LOGO_URL = (process.env.LIBRARY_LOGO_URL || `${(process.env.LIBRARY_PUBLIC_URL || 'https://qalam-library.onrender.com').replace(/\/+$/, '')}/assets/qalam-q-logo.png`).trim();

const TONES = {
  success: { bg: '#e4f3e9', color: '#1f6b44' },
  warning: { bg: '#fdecd1', color: '#9a5b10' },
  danger: { bg: '#fbe3e1', color: '#a23b30' },
  info: { bg: '#e3edf7', color: '#1c5a8c' },
  neutral: { bg: '#efe9d8', color: '#7a5a1e' },
};

export const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** فقرات نص عادي إلى HTML آمن (يهرب كل فقرة، فلا حاجة لتهريبها عند الاستدعاء). */
export function paragraphs(lines) {
  return lines.filter(Boolean).map(line => `<p style="margin:0 0 10px;font-size:14px;line-height:1.9;color:#2c4337">${esc(line)}</p>`).join('');
}

/** قائمة خطوات مرقّمة بدوائر ذهبية صغيرة، لتعليمات «افعل كذا ثم كذا». */
export function steps(items) {
  return `<ol style="margin:6px 0 14px;padding:0;list-style:none">${items.filter(Boolean).map((item, index) => `
    <li style="display:flex;gap:10px;align-items:flex-start;margin:0 0 9px">
      <span style="flex:none;width:22px;height:22px;border-radius:50%;background:#163428;color:#f4e3b4;font-size:12px;font-weight:700;line-height:22px;text-align:center;font-family:Tahoma,Arial,sans-serif">${index + 1}</span>
      <span style="font-size:13.5px;line-height:1.8;color:#2c4337;padding-top:1px">${esc(item)}</span>
    </li>`).join('')}</ol>`;
}

/** زر إجراء بارز (رابط). */
export function actionButton(url, label) {
  return `<p style="margin:14px 0 0"><a href="${esc(url)}" style="display:inline-block;background:#163428;color:#f4e3b4;padding:10px 20px;border-radius:999px;text-decoration:none;font-size:13.5px;font-weight:700">${esc(label)}</a></p>`;
}

/**
 * يبني رسالة HTML كاملة مزدوجة اللغة.
 * tone: success | warning | danger | info | neutral — يلوّن شارة الحالة في كل قسم لغوي.
 */
export function renderEmailHtml({ tone = 'neutral', badgeAr, badgeFr, headingAr, headingFr, bodyHtmlAr, bodyHtmlFr, preheader = '' }) {
  const t = TONES[tone] || TONES.neutral;
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(headingAr)}</title>
<style>
  body,table,td{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  body{margin:0;padding:0}
  img{border:0;outline:none;text-decoration:none}
  a{color:#163428}
</style>
</head>
<body style="margin:0;padding:0;background:#f2efe3" bgcolor="#f2efe3">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f2efe3" style="background:#f2efe3"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden">
<tr><td align="center" bgcolor="#0d2e24" style="background:#0d2e24;padding:26px 24px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" bgcolor="#ffffff" style="width:56px;height:56px;border-radius:50%;background:#ffffff">
    <img src="${LOGO_URL}" width="34" height="34" alt="قلم" style="display:block;margin:11px auto">
  </td></tr></table>
  <div style="font-family:Tahoma,Arial,sans-serif;color:#f4e3b4;font-size:13px;letter-spacing:.5px;margin-top:10px">المكتبة الرقمية · قلم · Qalam</div>
</td></tr>
<tr><td style="padding:20px 26px 0">
  <span style="display:inline-block;background:${t.bg};color:${t.color};font-size:11.5px;font-weight:700;padding:4px 12px;border-radius:999px;font-family:Tahoma,Arial,sans-serif">${esc(badgeAr)}</span>
</td></tr>
<tr><td dir="rtl" lang="ar" style="padding:10px 26px 4px;font-family:Tahoma,Arial,sans-serif">
  <h1 style="margin:0 0 10px;font-size:19px;color:#163428">${esc(headingAr)}</h1>
  ${bodyHtmlAr}
  <p style="margin:16px 0 0;font-family:Georgia,'Times New Roman',serif;font-style:italic;color:#8a6a2d;font-size:16px">بقلم — الزلوطي</p>
</td></tr>
<tr><td style="padding:16px 26px 0"><div style="border-top:1px solid #e3e1cf"></div></td></tr>
<tr><td style="padding:14px 26px 2px">
  <span style="display:inline-block;background:${t.bg};color:${t.color};font-size:11px;font-weight:700;padding:3px 11px;border-radius:999px;font-family:Tahoma,Arial,sans-serif">${esc(badgeFr)}</span>
</td></tr>
<tr><td dir="ltr" lang="fr" style="padding:8px 26px 22px;font-family:Tahoma,Arial,sans-serif">
  <h1 style="margin:0 0 10px;font-size:17px;color:#163428">${esc(headingFr)}</h1>
  ${bodyHtmlFr}
  <p style="margin:16px 0 0;font-family:'Lucida Handwriting','Brush Script MT',cursive,Georgia,serif;font-style:italic;color:#8a6a2d;font-size:18px">— ZOULOUTI</p>
</td></tr>
<tr><td align="center" bgcolor="#f7f5ea" style="background:#f7f5ea;padding:16px 26px;font-family:Tahoma,Arial,sans-serif;font-size:11px;color:#5c7265;line-height:1.8">
  المكتبة الرقمية — منصة قلم · رسالة آلية، لا حاجة للرد عليها<br>Message automatique de la Bibliothèque numérique Qalam — merci de ne pas y répondre
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

/** نص بديل بسيط (عربي ثم فرنسي) لعملاء البريد التي لا تعرض HTML. */
export function renderEmailText({ headingAr, bodyLinesAr, headingFr, bodyLinesFr }) {
  return [
    headingAr,
    '',
    ...bodyLinesAr.filter(Boolean),
    '',
    'بقلم — الزلوطي',
    '',
    '―――――――――――――――――――',
    '',
    headingFr,
    '',
    ...(bodyLinesFr || []).filter(Boolean),
    '',
    '— ZOULOUTI',
  ].join('\n');
}
