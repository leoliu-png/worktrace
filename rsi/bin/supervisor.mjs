import {spawn} from 'node:child_process';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {loadConfig} from '../lib/config.mjs';
const config=loadConfig();writeFileSync(path.join(config.home,'supervisor.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()},null,2));
let failures=0;
for(;;){const child=spawn(process.execPath,[path.join(config.projectRoot,'rsi/bin/service.mjs')],{cwd:config.projectRoot,windowsHide:true,stdio:['ignore','inherit','inherit']});const code=await new Promise(resolve=>{child.on('exit',resolve);child.on('error',()=>resolve(1));});if(code===0)break;if(code===2&&existsSync(path.join(config.home,'service.json'))){const info=JSON.parse(readFileSync(path.join(config.home,'service.json'),'utf8'));let alive=false;try{process.kill(info.pid,0);alive=true;}catch{}if(alive)break;}failures++;const delay=Math.min(30000,5000*failures);console.error(`自动优化服务退出，${delay/1000} 秒后恢复。`);await new Promise(resolve=>setTimeout(resolve,delay));}
