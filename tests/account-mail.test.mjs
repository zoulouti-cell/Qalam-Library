import test from 'node:test';
import assert from 'node:assert/strict';
import { activationToken, tokenDigest, safeToken, activationUrl, activationMessage, validEmail, sendMail } from '../src/account-mail.mjs';

test('activation links use a single-use sized random token and fixed library origin', () => {
  const first = activationToken(), second = activationToken();
  assert.equal(safeToken(first), true);
  assert.notEqual(first, second);
  assert.match(tokenDigest(first), /^[a-f0-9]{64}$/);
  assert.equal(activationUrl(first), 'https://qalam-library.onrender.com/activate?token=' + first);
  assert.equal(safeToken(first + 'x'), false);
});

test('Arabic invitation escapes link markup and validates email syntax', () => {
  const mail = activationMessage('https://qalam-library.onrender.com/activate?token=a&x="b"');
  assert.match(mail.subject, /فعّل حسابك/);
  assert.match(mail.html, /&amp;x=&quot;b&quot;/);
  assert.equal(validEmail('reader@example.com'), true);
  assert.equal(validEmail('not an email'), false);
});

test('Brevo request keeps the API key in the header and sends an Arabic activation link', async () => {
  const previous={key:process.env.BREVO_API_KEY,sender:process.env.BREVO_SENDER_EMAIL,fetch:globalThis.fetch};
  process.env.BREVO_API_KEY='test-only-secret';process.env.BREVO_SENDER_EMAIL='sender@example.com';
  let called=false;
  globalThis.fetch=async (url,options)=>{
    called=true;
    assert.equal(url,'https://api.brevo.com/v3/smtp/email');
    assert.equal(options.headers['api-key'],'test-only-secret');
    const body=JSON.parse(options.body);
    assert.equal(body.sender.email,'sender@example.com');
    assert.equal(body.to[0].email,'reader@example.com');
    assert.match(body.htmlContent,/تفعيل الحساب/);
    assert.equal(options.body.includes('test-only-secret'),false);
    return {ok:true,status:201};
  };
  try{const mail=activationMessage(activationUrl(activationToken()));await sendMail('reader@example.com',mail.subject,mail.text,mail.html);assert.equal(called,true);}
  finally{globalThis.fetch=previous.fetch;if(previous.key===undefined)delete process.env.BREVO_API_KEY;else process.env.BREVO_API_KEY=previous.key;if(previous.sender===undefined)delete process.env.BREVO_SENDER_EMAIL;else process.env.BREVO_SENDER_EMAIL=previous.sender;}
});
