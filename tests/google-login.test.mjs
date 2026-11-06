import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { beginGoogleLogin, finishGoogleFlow, verifyGoogleIdToken } from '../src/google-login.mjs';

test('Google login state is signed, time bound and tied to the browser cookie',()=>{
  const config={clientId:'client-id',clientSecret:'secret',sessionSecret:'test-session-secret',redirectUri:'https://qalam-library.onrender.com/api/auth/google/callback'};
  const flow=beginGoogleLogin(config,'admin'),url=new URL(flow.url);
  assert.equal(url.searchParams.get('scope'),'openid email profile');
  assert.equal(url.searchParams.get('redirect_uri'),config.redirectUri);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(finishGoogleFlow(flow.cookie,url.searchParams.get('state'),config.sessionSecret).destination,'admin');
  assert.equal(finishGoogleFlow(flow.cookie,'wrong-state',config.sessionSecret),null);
  assert.equal(finishGoogleFlow(flow.cookie,url.searchParams.get('state'),'wrong-secret'),null);
});

test('Google ID token requires a valid signature, audience, nonce and verified email',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk=publicKey.export({format:'jwk'});
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,headers:{get:()=> 'max-age=300'},json:async()=>({keys:[{...jwk,kid:'test-key',use:'sig'}]})});
  const now=Math.floor(Date.now()/1000);
  const claims={iss:'https://accounts.google.com',aud:'client-id',sub:'123456789',email:'owner@gmail.com',email_verified:true,iat:now,exp:now+3600,nonce:'nonce-value'};
  const tokenFor=value=>{const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url'),payload=Buffer.from(JSON.stringify(value)).toString('base64url'),data=`${header}.${payload}`;return `${data}.${sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}`;};
  try{
    assert.equal((await verifyGoogleIdToken(tokenFor(claims),'client-id','nonce-value')).email,'owner@gmail.com');
    const withProfile=await verifyGoogleIdToken(tokenFor({...claims,name:'مالك الحساب',picture:'https://lh3.googleusercontent.com/a/photo=s96-c'}),'client-id','nonce-value');
    assert.equal(withProfile.name,'مالك الحساب');assert.equal(withProfile.picture,'https://lh3.googleusercontent.com/a/photo=s96-c');
    assert.equal((await verifyGoogleIdToken(tokenFor({...claims,picture:'https://evil.example/x.png'}),'client-id','nonce-value')).picture,'');
    await assert.rejects(()=>verifyGoogleIdToken(tokenFor({...claims,aud:'other-client'}),'client-id','nonce-value'));
    await assert.rejects(()=>verifyGoogleIdToken(tokenFor({...claims,email_verified:false}),'client-id','nonce-value'));
    await assert.rejects(()=>verifyGoogleIdToken(tokenFor(claims),'client-id','other-nonce'));
    const token=tokenFor(claims);await assert.rejects(()=>verifyGoogleIdToken(`${token.slice(0,-4)}abcd`,'client-id','nonce-value'));
  }finally{globalThis.fetch=oldFetch;}
});
