/* استعادة كلمة المرور بالبريد للحسابات الفردية في المكتبة.
   - الطلب يردّ دائمًا بجواب عام (200) قبل البحث والإرسال، فلا يُكشف وجود حساب بالمحتوى ولا بالتوقيت.
   - الرمز 32 بايتًا عشوائيًا؛ لا يُخزَّن إلا بصمته (sha256)، صلاحيته 30 دقيقة، ويُستعمل مرة واحدة.
   - عند التغيير يُحفظ passwordChangedAt فتسقط كل الجلسات الصادرة قبله (انظر الحارس المبكر في server.mjs). */
import { emailReady, validEmail, activationToken, tokenDigest, safeToken, sendMail, passwordResetUrl, passwordResetMessage, passwordChangedMessage } from './account-mail.mjs';
import { hashPassword, recordAudit } from './admin-store.mjs';

export const RESET_TTL_MS = 30 * 60_000;
const IP_WINDOW_MS = 15 * 60_000, IP_REQUEST_LIMIT = 6, IP_FAILURE_LIMIT = 10;
const ACCOUNT_WINDOW_MS = 3600_000, ACCOUNT_REQUEST_LIMIT = 3, COOLDOWN_MS = 60_000;
const GENERIC = 'إذا كان البريد مسجَّلًا في المكتبة فقد أرسلنا إليه رابط الاستعادة. صلاحيته 30 دقيقة.';

export function createPasswordReset({ store, afterReset = () => {} }) {
  const requestsByIp = new Map(), requestsByAccount = new Map(), failuresByIp = new Map();
  const hit = (table, key, windowMs) => {
    const now = Date.now(), item = table.get(key);
    if (!item || now - item.start > windowMs) { table.set(key, { start: now, count: 1 }); return 1; }
    item.count += 1; return item.count;
  };
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [table, windowMs] of [[requestsByIp, IP_WINDOW_MS], [requestsByAccount, ACCOUNT_WINDOW_MS], [failuresByIp, IP_WINDOW_MS]]) for (const [key, item] of table) if (now - item.start > windowMs) table.delete(key);
  }, 10 * 60_000);
  sweep.unref();

  async function deliver(email) {
    // يُحسب الإرسال الفعلي لا الطلبات المكبوحة بالفاصل، فلا يستهلك نقرٌ مزدوج حصة المستخدم الحقيقي.
    const issued = requestsByAccount.get(email);
    if (issued && Date.now() - issued.start <= ACCOUNT_WINDOW_MS && issued.count >= ACCOUNT_REQUEST_LIMIT) return;
    const token = activationToken(), digest = tokenDigest(token), now = Date.now();
    const user = await store.users.findOneAndUpdate(
      { email, active: true, accountStatus: { $nin: ['pending', 'permanent'] }, passwordHash: { $type: 'string' }, $or: [{ resetRequestedAt: { $exists: false } }, { resetRequestedAt: { $lt: new Date(now - COOLDOWN_MS) } }] },
      { $set: { resetTokenHash: digest, resetExpiresAt: new Date(now + RESET_TTL_MS), resetRequestedAt: new Date(now) } },
      { returnDocument: 'after', projection: { email: 1 } },
    );
    if (!user) return;
    hit(requestsByAccount, email, ACCOUNT_WINDOW_MS);
    try {
      const message = passwordResetMessage(passwordResetUrl(token));
      await sendMail(email, message.subject, message.text, message.html);
    } catch (error) {
      await store.users.updateOne({ _id: user._id, resetTokenHash: digest }, { $unset: { resetTokenHash: '', resetExpiresAt: '' } });
      console.error('Password reset mail failed:', error?.message || 'delivery_error');
      return;
    }
    try { await recordAudit(store, email, 'password_reset_requested', email); } catch (error) { console.error('Password reset audit failed:', error?.message || 'unknown error'); }
  }

  /** يعيد { status, body, done }؛ done وعد العمل الخلفي (للاختبارات فقط) ولا يُنتظر في الخادم. */
  async function request(input, ip) {
    if (!store || !emailReady()) return { status: 503, body: { error: 'استعادة كلمة المرور غير متاحة الآن لأن خدمة البريد غير مهيأة. تواصل مع إدارة المكتبة.' } };
    const email = String(input?.email || '').trim().toLowerCase();
    if (!validEmail(email) || email.length > 254) return { status: 400, body: { error: 'أدخل بريداً إلكترونياً صالحاً.' } };
    if (hit(requestsByIp, ip, IP_WINDOW_MS) > IP_REQUEST_LIMIT) return { status: 429, body: { error: 'طلبات كثيرة. أعد المحاولة بعد ربع ساعة.' } };
    return { status: 200, body: { ok: true, message: GENERIC }, done: deliver(email).catch(error => console.error('Password reset request failed:', error?.message || 'unknown error')) };
  }

  async function confirm(input, ip) {
    if (!store) return { status: 503, body: { error: 'خدمة الحسابات غير متاحة الآن.' } };
    const failed = failuresByIp.get(ip);
    if (failed && Date.now() - failed.start <= IP_WINDOW_MS && failed.count >= IP_FAILURE_LIMIT) return { status: 429, body: { error: 'محاولات كثيرة. أعد المحاولة بعد ربع ساعة.' } };
    const token = String(input?.token || ''), password = String(input?.password || '');
    // الطول يُفحص قبل استهلاك الرمز: كلمة قصيرة لا تحرق رابطًا صالحًا.
    if (!safeToken(token) || password.length < 12 || password.length > 256) return { status: 400, body: { error: 'رابط الاستعادة أو كلمة المرور غير صالحين؛ اختر كلمة من 12 إلى 256 حرفاً.' } };
    const now = new Date(), saved = hashPassword(password);
    const user = await store.users.findOneAndUpdate(
      { resetTokenHash: tokenDigest(token), resetExpiresAt: { $gt: now }, active: true },
      { $set: { passwordSalt: saved.salt, passwordHash: saved.hash, mustChangePassword: false, passwordChangedAt: now, updatedAt: now }, $unset: { resetTokenHash: '', resetExpiresAt: '', resetRequestedAt: '' } },
      { returnDocument: 'after', projection: { email: 1 } },
    );
    if (!user) { hit(failuresByIp, ip, IP_WINDOW_MS); return { status: 400, body: { error: 'انتهت صلاحية رابط الاستعادة أو استُخدم سابقاً. اطلب رابطاً جديداً.' } }; }
    failuresByIp.delete(ip);
    afterReset(ip, user.email);
    try { await recordAudit(store, user.email, 'password_reset', user.email); } catch (error) { console.error('Password reset audit failed:', error?.message || 'unknown error'); }
    let done = Promise.resolve();
    if (emailReady()) {
      const message = passwordChangedMessage();
      done = sendMail(user.email, message.subject, message.text, message.html).catch(error => console.error('Password changed notice failed:', error?.message || 'delivery_error'));
    }
    return { status: 200, body: { ok: true, message: 'تم تغيير كلمة المرور. يمكنك تسجيل الدخول الآن.' }, done };
  }

  return { request, confirm };
}
