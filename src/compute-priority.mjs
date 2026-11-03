import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const work=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../work');
export async function reserveInteractiveCompute(){
  const statusFile=path.join(work,'ingestion-status.json');let live=false;
  try{live=JSON.parse(fs.readFileSync(statusFile,'utf8')).running===true;}catch{}
  if(!live)return ()=>{};
  const file=path.join(work,'assistant-priority.json'),token=String(Date.now())+'-'+Math.random().toString(36).slice(2);
  fs.mkdirSync(work,{recursive:true});fs.writeFileSync(file,JSON.stringify({token,until:Date.now()+115000}));
  const release=()=>{try{if(JSON.parse(fs.readFileSync(file,'utf8')).token===token)fs.unlinkSync(file);}catch{}};
  try{const end=Date.now()+10000;while(Date.now()<end){const status=JSON.parse(fs.readFileSync(statusFile,'utf8'));if(!status.running||status.status==='paused_for_assistant')break;await new Promise(resolve=>setTimeout(resolve,250));}}catch{}
  return release;
}

