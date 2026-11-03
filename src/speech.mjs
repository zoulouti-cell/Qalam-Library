import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sibling=path.resolve(ROOT,'..','adala');
const piperDir=process.env.PIPER_DIR||path.join(sibling,'tts','piper');
const piper=process.env.PIPER_BIN||path.join(piperDir,process.platform==='win32'?'piper.exe':'piper');
const voice=process.env.PIPER_MODEL||path.join(sibling,'tts','ar-voice.onnx');
const installedWhisper=fs.existsSync(path.join(ROOT,'work','whisper','bin','whisper-server.exe'))&&fs.existsSync(path.join(ROOT,'work','whisper','models','ggml-base-q5_1.bin'));
const engine=process.env.STT_ENGINE==='whisper'||(!process.env.STT_ENGINE&&installedWhisper)?'whisper':'vosk';
const endpoint=process.env.STT_BASE_URL||(engine==='whisper'?'http://127.0.0.1:8082':'http://127.0.0.1:8081');
function localEndpoint(){const u=new URL(endpoint);if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!['http:','https:'].includes(u.protocol))throw new Error('Speech endpoint must be local');return u.href.replace(/\/$/,'');}
let cache=null,busy=false;
export async function speechCapabilities(){
  if(cache&&Date.now()-cache.at<15000)return cache.value;
  let sttAvailable=false;
  try{const r=await fetch(localEndpoint()+(engine==='whisper'?'/':'/health'),{signal:AbortSignal.timeout(800)});sttAvailable=r.ok||engine==='vosk'&&r.status===501;}catch{}
  const value={piperAvailable:fs.existsSync(piper)&&fs.existsSync(voice),sttAvailable,sttEngine:engine,voiceLabel:'صوت عربي محلي اختياري'};
  cache={at:Date.now(),value};return value;
}
export async function transcribe(wav){
  if(wav.length<44||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw new Error('أرسل تسجيل WAV أحادي القناة.');
  let response;
  if(engine==='whisper'){
    const form=new FormData();form.append('file',new Blob([wav],{type:'audio/wav'}),'dictation.wav');form.append('response_format','json');form.append('language','ar');form.append('temperature','0');
    form.append('prompt','نص قانوني مغربي. محكمة النقض، المسطرة المدنية، المسطرة الجنائية، مدونة الأسرة، المادة، الفصل، النيابة العامة.');
    response=await fetch(localEndpoint()+'/inference',{method:'POST',body:form,signal:AbortSignal.timeout(60000)});
  }else response=await fetch(localEndpoint()+'/',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav,signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error('تعذر التعرف الصوتي المحلي.');const data=await response.json();return {text:String(data.text||data.transcription||'').trim(),engine,warnings:['راجع الأسماء والأرقام القانونية قبل استعمال الإملاء.']};
}
export async function synthesize(text){
  if(busy)throw new Error('القارئ المحلي مشغول.');
  if(!fs.existsSync(piper)||!fs.existsSync(voice))throw new Error('القارئ المحلي غير مثبت؛ استخدم صوت المتصفح.');
  text=String(text||'').trim();if(!text||text.length>2500)throw new Error('مقطع القراءة طويل أو فارغ.');
  busy=true;const scratch=path.join(ROOT,'work');fs.mkdirSync(scratch,{recursive:true});const dir=fs.mkdtempSync(path.join(scratch,'qalam-voice-')),output=path.join(dir,'speech.wav');
  try{return await new Promise((resolve,reject)=>{
    const child=spawn(piper,['--model',voice,'--output_file',output],{cwd:piperDir,windowsHide:true,stdio:['pipe','ignore','pipe']});
    const timer=setTimeout(()=>{child.kill();reject(new Error('انتهت مهلة توليد الصوت.'));},25000);
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('تعذر تشغيل القارئ المحلي.'));});
    child.on('close',code=>{clearTimeout(timer);if(code===0&&fs.existsSync(output))resolve(fs.readFileSync(output));else reject(new Error('تعذر توليد الصوت المحلي.'));});
    child.stdin.end(text+'\n');
  });}finally{busy=false;try{const safe=path.resolve(dir),root=path.resolve(scratch);if(safe.startsWith(root+path.sep)&&path.basename(safe).startsWith('qalam-voice-'))fs.rmSync(safe,{recursive:true,force:true});}catch{}}
}

