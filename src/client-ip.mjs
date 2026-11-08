// The visitor's address, used only for rate limits.
// Behind Render's proxy every connection comes from the proxy itself, so the socket address would put all
// visitors in one bucket (one attacker could lock everybody out, or legitimate visitors could share one
// throttled bucket). Forwarded headers are trusted only when the server runs behind a known proxy
// (Render sets RENDER; elsewhere set QALAM_TRUST_PROXY=1).
const trustProxy = Boolean(process.env.RENDER || process.env.QALAM_TRUST_PROXY);

export function clientIp(req) {
  if (trustProxy) {
    const direct = String(req.headers['cf-connecting-ip'] || req.headers['true-client-ip'] || '').trim();
    if (direct) return direct.slice(0, 64);
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(part => part.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[0].slice(0, 64);
  }
  return req.socket?.remoteAddress || 'unknown';
}
