import {spawn} from 'node:child_process';
import {openSync,existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {loadConfig,cleanEnvironment} from '../lib/config.mjs';
const config=loadConfig();
try{const response=await fetch(`http://127.0.0.1:${config.controlPort}/health`,{signal:AbortSignal.timeout(1500)});if(response.ok){console.log('自动优化服务已在运行。');process.exit(0);}}catch{}
const out=openSync(path.join(config.home,'supervisor.log'),'a'),err=openSync(path.join(config.home,'supervisor-error.log'),'a');
const child=spawn(process.execPath,[path.join(config.projectRoot,'rsi/bin/supervisor.mjs')],{cwd:config.projectRoot,env:cleanEnvironment({RSI_HOME:config.home,...(config.codexEntry?{RSI_CODEX_ENTRY:config.codexEntry}:{})}),detached:true,windowsHide:true,stdio:['ignore',out,err]});
child.unref();console.log(JSON.stringify({pid:child.pid,control:`http://127.0.0.1:${config.controlPort}`,home:config.home,mode:'background'}));
