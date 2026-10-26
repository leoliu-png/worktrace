import {spawn} from 'node:child_process';
import {mkdirSync,createWriteStream} from 'node:fs';
import path from 'node:path';
export async function run(command,args,{cwd,env,timeout=300000,input,logFile,signal,onPid}={}){
 if(signal?.aborted)throw Error('运行已停止。');
 return await new Promise((resolve,reject)=>{
  let log=null,logged=0;if(logFile){mkdirSync(path.dirname(logFile),{recursive:true});log=createWriteStream(logFile);log.on('error',()=>{});}
  const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='',finished=false,timedOut=false;
  onPid?.(child.pid);
  const append=(target,chunk)=>{const text=chunk.toString();return (target+text).slice(-2_000_000);};
  const record=chunk=>{if(log&&logged<16*1024*1024){log.write(chunk);logged+=chunk.length;}};
  child.stdout.on('data',chunk=>{out=append(out,chunk);record(chunk);});child.stderr.on('data',chunk=>{err=append(err,chunk);record(chunk);});
  const stop=()=>{if(finished)return;timedOut=true;if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGTERM');};
  const timer=setTimeout(stop,timeout);signal?.addEventListener('abort',stop,{once:true});
  child.on('error',error=>{finished=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);log?.end();reject(error);});
  child.on('close',async code=>{finished=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);if(log)await new Promise(done=>log.end(done));resolve({code:timedOut?-1:code,out,err,timedOut});});
  child.stdin.on('error',()=>{});child.stdin.end(input??'');
 });
}
export async function stopRecordedApp(config,record){
 if(!record?.pid)return;
 try{process.kill(record.pid,0);}catch{return;}
 if(process.platform!=='win32')throw Error('检测到上次运行的应用进程，请确认后手动停止，再重启服务。');
 if(!Number.isInteger(record.pid)||!Number.isInteger(record.port)||!Number.isInteger(record.parentPid))throw Error('Invalid recorded process.');
 const script=`$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${record.pid}'; if ($p) { $p | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress }`;
 const result=await run('powershell.exe',['-NoProfile','-Command',script],{timeout:10000});
 let processInfo;try{processInfo=JSON.parse(result.out);}catch{throw Error('不能验证上次应用进程，已停止自动恢复。');}
 const command=String(processInfo.CommandLine||'').replaceAll('\\','/');const expected=path.join(config.projectRoot,'node_modules/next/dist/bin/next').replaceAll('\\','/');
 if(processInfo.ParentProcessId!==record.parentPid||!command.includes(expected)||!command.includes(String(record.port+1)))throw Error('上次应用进程标识不匹配，未结束该进程。');
 await run('taskkill',['/PID',String(record.pid),'/T','/F'],{timeout:10000});
}
