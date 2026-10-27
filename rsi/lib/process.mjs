import {spawn} from 'node:child_process';
import {mkdirSync,openSync,writeSync,closeSync} from 'node:fs';
import path from 'node:path';
export async function run(command,args,{cwd,env,timeout=300000,input,logFile,signal,onPid}={}){
 if(signal?.aborted)throw Error('运行已停止。');
 return await new Promise((resolve,reject)=>{
  let log=null,logged=0;if(logFile){mkdirSync(path.dirname(logFile),{recursive:true});log=openSync(logFile,'w');}
  const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='',finished=false,timedOut=false,aborted=false,stopping=false,drainTimer,stopTimer;
  const started=Date.now();
  const cleanup=()=>{clearTimeout(timer);clearInterval(watchdog);clearTimeout(drainTimer);clearTimeout(stopTimer);signal?.removeEventListener('abort',abort);child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();if(log!==null){try{closeSync(log);}catch{}log=null;}};
  const finish=(code,error)=>{if(finished)return;finished=true;cleanup();if(error)reject(error);else resolve({code:timedOut||aborted?-1:code,out,err,timedOut,aborted});};
  const append=(target,chunk)=>{const text=chunk.toString();return (target+text).slice(-2_000_000);};
  const record=chunk=>{if(log!==null&&logged<16*1024*1024){try{const bytes=chunk.subarray(0,16*1024*1024-logged);logged+=writeSync(log,bytes);}catch{try{closeSync(log);}catch{}log=null;err=append(err,'\nProcess log could not be written.');}}};
  child.stdout.on('data',chunk=>{out=append(out,chunk);record(chunk);});child.stderr.on('data',chunk=>{err=append(err,chunk);record(chunk);});
  const stop=()=>{if(finished||stopping)return;stopping=true;if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>{try{child.kill();}catch{}});killer.unref();}else child.kill('SIGTERM');
   // A descendant can keep inherited pipes open after the command has died.
   // Never depend on its close event (or an asynchronous log flush) to settle.
   stopTimer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}finish(-1);},2000);
  };
  const expire=()=>{timedOut=true;stop();},abort=()=>{aborted=true;stop();};
  const timer=setTimeout(expire,timeout),watchdog=setInterval(()=>{if(Date.now()-started>=timeout)expire();},1000);
  signal?.addEventListener('abort',abort,{once:true});
  child.on('error',error=>finish(null,error));
  child.on('exit',code=>{drainTimer=setTimeout(()=>finish(code),1000);});
  child.on('close',code=>finish(code));
  child.stdin.on('error',()=>{});child.stdin.end(input??'');
  onPid?.(child.pid);
  if(signal?.aborted)abort();
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
