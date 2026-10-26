import {createServer} from 'node:http';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {publicSettings} from './config.mjs';
import {statusReport} from './status.mjs';
import {processingBlock} from './task-policy.mjs';
const validId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
export async function controlServer(config,store,pipeline,{requestSweep,shutdown}){
 const authenticate=req=>{const actual=Buffer.from(req.headers.authorization||'');const expected=Buffer.from('Bearer '+config.controlSecret);return actual.length===expected.length&&timingSafeEqual(actual,expected);};
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.url==='/health'&&req.method==='GET'){res.end(JSON.stringify({alive:true,ready:store.get('appReady',false),heartbeat:store.get('heartbeat')}));return;}
  if(req.url==='/'&&req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><meta charset="utf-8"><title>WorkTrace 自动优化服务</title><main style="max-width:800px;margin:60px auto;font:18px/1.7 system-ui"><h1>WorkTrace 自动优化服务</h1><p>服务已启动。首次准备本地应用可能需要几分钟。</p><p><a href="${config.appUrl}/_rsi/login/admin-a">打开 WorkTrace 自动优化控制台</a></p><p>仅使用本地合成数据。生产环境发布未启用。</p></main>`);return;}
  if(!authenticate(req)){res.writeHead(401).end(JSON.stringify({error:'Unauthorized'}));return;}
  try{
   if(req.method==='GET'&&req.url==='/status'){res.end(JSON.stringify({...statusReport(config,store),settings:publicSettings(config)}));return;}
   const patchMatch=/^\/tasks\/([a-f0-9-]{36})\/patch$/.exec(req.url||'');
   if(req.method==='GET'&&patchMatch){const task=store.find(patchMatch[1]);if(!task)throw Error('任务不存在。');const filename=path.join(config.home,'tasks',task.id,'candidate.patch');res.end(JSON.stringify({patch:existsSync(filename)?readFileSync(filename,'utf8').slice(0,150000):'候选改动尚未准备好。'}));return;}
   if(req.method!=='POST')return res.writeHead(404).end('{}');
   let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>10000)throw Error('请求过长。');}const input=JSON.parse(body||'{}');
   if(req.url==='/control'){
    if(input.action==='pause'){store.set('enabled',false);store.event(null,'paused','已暂停新任务；执行中的任务会完成当前处理。');}
    else if(input.action==='resume'){store.set('enabled',true);store.set('backoffUntil',null);store.event(null,'resumed','已继续自动运行。');}
    else if(input.action==='sweep'){const requested=requestSweep();if(requested)store.event(null,'manual_sweep',store.get('enabled')?'已安排一次手动巡检，空闲时执行。':'已安排一次手动巡检；执行完毕后继续保持暂停。');res.end(JSON.stringify({ok:true,message:requested?'已安排一次巡检；可在当前执行区域查看进度。':'已有一次巡检在等待执行，无需重复点击。'}));return;}
    else if(input.action==='process'){
     if(input.actor?.role!=='ADMIN'||typeof input.actor.id!=='string'||typeof input.actor.name!=='string')throw Error('需要管理员身份。');
     if(input.taskId&&!validId(input.taskId))throw Error('无效任务。');
     await pipeline.ingest();
     const pending=store.get('processRequested');
     if(pending){if(input.taskId&&input.taskId!==pending.taskId)throw Error('已有一条手动优化请求，请等待其结束。');res.end(JSON.stringify({ok:true,message:`“${pending.title}”已安排手动处理，无需重复点击。`}));return;}
     const task=input.taskId?store.find(input.taskId):store.next();
     if(!task)throw Error('没有等待处理的反馈。请先在“建议反馈”提交具体问题，或巡检发现新问题后再试。');
     const blocked=processingBlock(config,store,task);if(blocked)throw Error(blocked);
     const request={id:randomUUID(),taskId:task.id,title:task.title,requestedBy:input.actor.name,requestedAt:new Date().toISOString(),state:'PENDING'};
     store.set('processRequested',request);store.event(task.id,'manual_process',`${input.actor.name} 请求手动处理一条反馈`,{requestId:request.id});
     res.end(JSON.stringify({ok:true,message:`已安排处理“${task.title}”。将执行筛选、开发、检查、评审和浏览器复测；通过后等待真人验收，自动运行开关保持不变。`}));return;
    }
    else if(input.action==='retry'){
     if(!validId(input.taskId))throw Error('无效任务。');const task=store.find(input.taskId);if(!task||!['ESCALATED','REJECTED'].includes(task.state))throw Error('此任务不能重试。');
     const active=store.get('activeProcess');if(active?.pid){try{process.kill(active.pid,0);throw Error('上次的 Agent 进程仍在运行，请先等待其结束。');}catch(error){if(error.code!=='ESRCH')throw error;}}
     if(input.actor?.role!=='ADMIN'||typeof input.actor.id!=='string'||typeof input.actor.name!=='string')throw Error('需要管理员身份。');
     store.retryTask(task.id,input.actor,input.note,config.maxRepairRounds);
    }else if(input.action==='close'){
     if(!validId(input.taskId)||input.actor?.role!=='ADMIN'||typeof input.actor.id!=='string'||typeof input.actor.name!=='string')throw Error('需要有效任务和管理员身份。');
     const task=store.find(input.taskId);if(task?.state==='CLOSED'){res.end(JSON.stringify({ok:true,message:'此任务已结束自动处理，后续由人工处理。'}));return;}
     if(!task||!['ESCALATED','REJECTED'].includes(task.state))throw Error('当前任务不能结束自动处理。');
     if(input.note!==undefined&&(typeof input.note!=='string'||input.note.length>1000))throw Error('人工处理说明最多填写 1000 字。');
     const note=input.note?.trim()||'已结束自动处理，后续由人工处理。';
     await pipeline.updateFeedback(task,'IN_PROGRESS',`自动处理已结束，后续由人工处理：${note}`,{handlingMode:'HUMAN'});
     const current=store.find(task.id);if(!current||!['ESCALATED','REJECTED'].includes(current.state))throw Error('任务状态已变化，请刷新后确认。');
     store.transition(task.id,'CLOSED',{reason:note,handlingMode:'HUMAN',closedBy:input.actor.name,closedAt:new Date().toISOString()});store.event(task.id,'closed',`${input.actor.name} 结束自动处理并转人工`,{note});
     res.end(JSON.stringify({ok:true,message:'已结束自动处理，后续由人工处理；此操作不会重新运行 Agent。'}));return;
    }else if(input.action==='stop'){store.set('enabled',false);res.end(JSON.stringify({ok:true}));setTimeout(shutdown,100);return;}
    else throw Error('无效操作。');res.end(JSON.stringify({ok:true}));return;
   }
   if(req.url==='/accept'){
    if(!validId(input.taskId)||typeof input.sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(input.sourceSha)||typeof input.actor?.id!=='string'||typeof input.actor?.name!=='string'||input.actor.role!=='ADMIN'||typeof input.note!=='string'||input.note.length>1000)throw Error('无效验收信息。');
    const task=store.find(input.taskId);if(!task)throw Error('任务不存在。');await pipeline.accept(task,input.actor,input.sourceSha,input.decision,input.note);res.end(JSON.stringify({ok:true}));return;
   }
   res.writeHead(404).end('{}');
  }catch(error){res.writeHead(400).end(JSON.stringify({error:error.message}));}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.controlPort,'127.0.0.1',resolve);});return server;
}
