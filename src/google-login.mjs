import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

const cookieName='qalam_google_flow';
/* في الاختبارات فقط يمكن توجيه نداءات Google إلى خادم محاكٍ؛ الإنتاج لا يقرأ هذا المتغير. */
const testOrigin=process.env.NODE_ENV==='test'?String(process.env.QALAM_TEST_GOOGLE_ORIGIN||''):'';
const authorizationEndpoint=testOrigin?`${testOrigin}/authorize`:'https://accounts.google.com/o/oauth2/v2/auth';
const tokenEndpoint=testOrigin?`${testOrigin}/token`:'https://oauth2.googleapis.com/token';
const keysEndpoint=testOrigin?`${testOrigin}/certs`:'https://www.googleapis.com/oauth2/v3/certs';
const revokeEndpoint=testOrigin?`${testOrigin}/revoke`:'https://oauth2.googleapis.com/revoke';
export const DRIVE_WRITE_SCOPE='https://www.googleapis.com/auth/drive';
let cachedKeys={until:0,keys:[]};

export function googleLoginConfig(){
  const clientId=String(process.env.GOOGLE_OAUTH_CLIENT_ID||'').trim();
  const clientSecret=String(process.env.GOOGLE_OAUTH_CLIENT_SECRET||'').trim();
  const sessionSecret=String(process.env.LIBRARY_SESSION_SECRET||'');
  const base=new URL(process.env.LIBRARY_PUBLIC_URL||'https://qalam-library.onrender.com');
  return {available:!!(clientId&&clientSecret&&sessionSecret),clientId,clientSecret,sessionSecret,redirectUri:new URL('/api/auth/google/callback',base).href};
}

function signedFlow(value,secret){
  const body=Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature=createHmac('sha256',secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function readFlow(value,secret){
  const [body,signature,...extra]=String(value||'').split('.');
  if(!body||!signature||extra.length||body.length>2000)return null;
  const expected=createHmac('sha256',secret).update(body).digest('base64url');
  const a=Buffer.from(signature),b=Buffer.from(expected);
  if(a.length!==b.length||!timingSafeEqual(a,b))return null;
  try{const flow=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));return Date.now()-flow.createdAt<600000&&Date.now()>=flow.createdAt&&flow.state&&flow.verifier&&flow.nonce?flow:null;}catch{return null;}
}

/* purpose='drive': ربط حساب المدير بـ Drive للكتابة (أصول الإضافات). يطلب رمز تحديث دائمًا ويفرض شاشة الموافقة. */
export function beginGoogleLogin(config,destination='reader',{purpose='login'}={}){
  const drive=purpose==='drive';
  const flow={state:randomBytes(32).toString('base64url'),nonce:randomBytes(32).toString('base64url'),verifier:randomBytes(32).toString('base64url'),createdAt:Date.now(),destination:drive||destination==='admin'?'admin':'reader',...(drive?{purpose:'drive'}:{})};
  const challenge=createHash('sha256').update(flow.verifier).digest('base64url');
  const url=new URL(authorizationEndpoint);
  const params={client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:drive?`openid email ${DRIVE_WRITE_SCOPE}`:'openid email profile',state:flow.state,nonce:flow.nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:drive?'consent select_account':'select_account',...(drive?{access_type:'offline'}:{})};
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  return {url:url.href,cookie:`${cookieName}=${signedFlow(flow,config.sessionSecret)}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=600`};
}

export const clearGoogleFlowCookie=`${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=0`;

export function finishGoogleFlow(cookieHeader,state,secret){
  const value=String(cookieHeader||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  const flow=readFlow(value,secret);
  if(!flow||typeof state!=='string')return null;
  const a=Buffer.from(flow.state),b=Buffer.from(state);
  return a.length===b.length&&timingSafeEqual(a,b)?flow:null;
}

async function googleKeys(){
  if(cachedKeys.until>Date.now())return cachedKeys.keys;
  const response=await fetch(keysEndpoint,{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('تعذر التحقق من مفاتيح Google.');
  const result=await response.json();
  if(!Array.isArray(result.keys))throw new Error('تعذر قراءة مفاتيح Google.');
  const age=Number(/max-age=(\d+)/.exec(response.headers.get('cache-control')||'')?.[1]||300);
  cachedKeys={until:Date.now()+Math.min(Math.max(age,60),3600)*1000,keys:result.keys};
  return cachedKeys.keys;
}

export async function verifyGoogleIdToken(token,clientId,nonce){
  if(typeof token!=='string'||token.length>20000)throw new Error('رمز هوية Google غير صالح.');
  const parts=token.split('.');
  if(parts.length!==3)throw new Error('رمز هوية Google غير صالح.');
  let header,claims;
  try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{throw new Error('رمز هوية Google غير صالح.');}
  if(header.alg!=='RS256'||!header.kid)throw new Error('توقيع هوية Google غير مدعوم.');
  const key=(await googleKeys()).find(item=>item.kid===header.kid&&item.kty==='RSA'&&item.use==='sig');
  if(!key||!verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw new Error('تعذر التحقق من توقيع Google.');
  const now=Math.floor(Date.now()/1000);
  if(!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||claims.aud!==clientId||!Number.isInteger(claims.exp)||claims.exp<=now||!Number.isInteger(claims.iat)||claims.iat>now+60||claims.nonce!==nonce||claims.email_verified!==true||typeof claims.sub!=='string'||!claims.sub||typeof claims.email!=='string')throw new Error('بيانات هوية Google غير مطابقة.');
  /* الاسم والصورة (نطاق profile) لعرض صاحب الحساب في الواجهة؛ الصورة من خوادم Google فقط */
  const name=typeof claims.name==='string'?claims.name.trim().slice(0,120):'';
  const picture=typeof claims.picture==='string'&&/^https:\/\/[a-z0-9-]+\.googleusercontent\.com\/[^\s"'<>]{1,500}$/i.test(claims.picture)?claims.picture:'';
  return {sub:claims.sub,email:claims.email.trim().toLowerCase(),hostedDomain:claims.hd||'',name,picture};
}

export async function exchangeGoogleTokens(code,flow,config){
  const body=new URLSearchParams({code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.redirectUri,grant_type:'authorization_code',code_verifier:flow.verifier});
  const response=await fetch(tokenEndpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('تعذر إتمام الدخول عبر Google. أعد المحاولة.');
  const result=await response.json();
  const identity=await verifyGoogleIdToken(result.id_token,config.clientId,flow.nonce);
  return {identity,accessToken:typeof result.access_token==='string'?result.access_token:'',refreshToken:typeof result.refresh_token==='string'?result.refresh_token:'',scopes:String(result.scope||'').split(/\s+/).filter(Boolean)};
}

export async function exchangeGoogleCode(code,flow,config){return (await exchangeGoogleTokens(code,flow,config)).identity;}

/* رمز وصول جديد من رمز التحديث المخزَّن. invalid_grant تعني أن الربط أُلغي أو انتهت صلاحيته فيلزم إعادة الربط. */
export async function refreshGoogleAccessToken(refreshToken,config){
  const body=new URLSearchParams({refresh_token:refreshToken,client_id:config.clientId,client_secret:config.clientSecret,grant_type:'refresh_token'});
  const response=await fetch(tokenEndpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||typeof data.access_token!=='string'){
    const error=new Error('تعذر تجديد تفويض Drive.');error.code=data?.error==='invalid_grant'?'invalid_grant':'refresh_failed';throw error;
  }
  return {accessToken:data.access_token,expiresIn:Math.min(Number(data.expires_in)||3600,3500)};
}

/* إلغاء الرمز لدى Google عند فك الربط أو رفض الحساب؛ محاولة بأفضل جهد لا تُفشل العملية. */
export async function revokeGoogleToken(token){
  if(!token)return false;
  try{const response=await fetch(revokeEndpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),signal:AbortSignal.timeout(8000)});return response.ok;}catch{return false;}
}
