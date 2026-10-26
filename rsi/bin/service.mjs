import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {loadConfig} from '../lib/config.mjs';
import {Store} from '../lib/store.mjs';
import {AppManager,seed} from '../lib/local-app.mjs';
import {integrationHead,checkout} from '../lib/git.mjs';
import {Pipeline} from '../lib/pipeline.mjs';
import {controlServer} from '../lib/control-server.mjs';
import {checkCandidate,buildFingerprint} from '../lib/checks.mjs';
import {stopRecordedApp} from '../lib/process.mjs';
import {processingBlock,canContinueTask} from '../lib/task-policy.mjs';
import {migrateFailureAccounting} from '../lib/recovery.mjs';

const config={...loadConfig(),appAuthSecret:randomBytes(48).toString('base64url'),appEncryptionSecret:randomBytes(48).toString('base64url')};
const store=new Store(config.database),owner=randomUUID();
if(!store.acquire(owner)){console.error('已有运行中的 WorkTrace 自动优化服务。');store.close();process.exit(2);}
store.recover();const accountingRecovered=migrateFailureAccounting(config,store);store.set('agentRetry',null);store.set('currentWork',null);store.set('phase','准备本地应用');store.set('appReady',false);store.set('serviceStartedAt',new Date().toISOString());
for(const name of ['baseline','stage']){await stopRecordedApp(config,store.get(`${name}Runtime`));store.set(`${name}Runtime`,null);}
if(store.get('enabled')===null)store.set('enabled',config.enabled);
const users=await seed(config),apps=new AppManager(config,store,users),pipeline=new Pipeline(config,store,apps,users);
await pipeline.migrateFeedbackHandling();
for(const task of store.listTasks())store.hydrateFailureMemory(task.id);
await pipeline.ingest();
for(const task of store.listTasks())if(task.state==='QUEUED'&&!canContinueTask(task,store.repairRoundsUsed(task.id),config.maxRepairRounds)||task.state==='ESCALATED'&&task.metadata.handlingMode!=='HUMAN')await pipeline.rejectToHuman(task,task.metadata.reason||`有效代码修复已达到 ${config.maxRepairRounds} 轮上限，仍有未解决的问题，需要人工处理。`);
for(const task of accountingRecovered)if(store.find(task.id)?.metadata.handlingMode!=='HUMAN')await pipeline.updateFeedback(task,'IN_PROGRESS',task.metadata.reason);
let busy=false,closing=false,lastPoll=0,bootRetry=0,timer;
const heartbeat=setInterval(()=>{try{store.renew(owner);}catch(error){console.error(error.message);shutdown();}},10000);
async function shutdown(){if(closing)return;closing=true;pipeline.abort.abort();clearInterval(timer);for(let attempt=0;busy&&attempt<40;attempt++)await new Promise(resolve=>setTimeout(resolve,250));clearInterval(heartbeat);await apps.stopAll().catch(()=>{});server.close();store.release(owner);store.close();process.exit(0);}
const server=await controlServer(config,store,pipeline,{requestSweep:()=>{const already=store.get('sweepRequested',false);store.set('sweepRequested',true);return !already;},shutdown});
writeFileSync(path.join(config.home,'service.json'),JSON.stringify({pid:process.pid,owner,projectRoot:config.projectRoot,controlPort:config.controlPort,startedAt:new Date().toISOString()},null,2));
store.event(null,'service_started','常驻服务已启动；仅操作本地测试环境。',{pid:process.pid});
async function bootstrap(){
 const sha=await integrationHead(config),root=await checkout(config,`baseline-${sha.slice(0,12)}`,sha),directory=path.join(config.home,'baseline-checks',sha);mkdirSync(directory,{recursive:true});
 let checks;const filename=path.join(directory,'checks.json');
 try{if(existsSync(filename)&&existsSync(path.join(root,'.next/BUILD_ID'))){const saved=JSON.parse(readFileSync(filename,'utf8'));if(saved.passed&&saved.sourceSha===sha&&saved.artifactHash===buildFingerprint(root))checks=saved;}}catch{}
 if(!checks){store.set('phase','首次检查并构建本地应用');checks=await checkCandidate(config,root,directory,{signal:pipeline.abort.signal,baseline:true});}
 store.set('baselineChecks',checks);if(!checks.passed)throw Error('基线检查未通过，自动修改已停止。请在控制台查看基线结果。');
 await apps.start('baseline',root);store.set('currentRelease',{sourceSha:sha,root});
 await pipeline.ingest();
 const waiting=store.listTasks().find(task=>task.state==='WAITING_ACCEPTANCE');
 if(waiting){if(buildFingerprint(waiting.metadata.release)!==waiting.metadata.artifactHash)throw Error('待验收构建产物变化，禁止自动恢复。');await apps.start('stage',waiting.metadata.release);}
 store.set('appReady',true);store.set('phase','等待任务');store.set('lastError',null);
}
function finishManualProcess(request,task){
 const result={...request,state:task?.state||'UNAVAILABLE',finishedAt:new Date().toISOString(),summary:task?.metadata.reason||'反馈任务不存在，未执行优化。'};
 store.set('lastManualProcess',result);store.set('processRequested',null);
 store.event(request.taskId,'manual_process_finished',`本次手动优化已结束：${result.summary}`,{requestId:request.id,state:result.state});
}
async function processRequestedFeedback(request){
 const task=store.find(request.taskId);
 if(!task||['WAITING_ACCEPTANCE','ACCEPTED','REJECTED','ESCALATED','CLOSED'].includes(task.state)){finishManualProcess(request,task);return;}
 if(!canContinueTask(task,store.repairRoundsUsed(task.id),config.maxRepairRounds)){await pipeline.rejectToHuman(task,`有效代码修复已达到 ${config.maxRepairRounds} 轮上限，调用故障单独计数。`);finishManualProcess(request,store.find(task.id));return;}
 const blocked=processingBlock(config,store,task);
 if(blocked){store.set('phase',`手动优化等待执行：${blocked}`);return;}
 const running={...request,state:'RUNNING',startedAt:request.startedAt||new Date().toISOString()};
 store.set('processRequested',running);store.set('phase','正在手动处理一条反馈');
 store.set('currentWork',{kind:'task',manual:true,taskId:task.id,title:task.title,startedAt:new Date().toISOString()});
 try{await pipeline.processTask(task);store.set('lastError',null);}
 finally{
  if(!closing){const latest=store.find(task.id);if(latest?.state==='QUEUED')store.set('processRequested',{...running,state:'PENDING'});else finishManualProcess(running,latest);}
 }
}
async function tick(){
 if(busy||closing)return;busy=true;
 try{
  if(!store.get('appReady')){if(Date.now()<bootRetry)return;await bootstrap();}
  const orphan=store.get('activeProcess');if(orphan?.pid){let alive=false;try{process.kill(orphan.pid,0);alive=true;}catch{}if(alive){store.set('phase','等待上次 Agent 进程结束，再恢复队列');return;}store.set('activeProcess',null);}
  const promotion=store.get('pendingPromotion');if(promotion){store.set('pendingPromotion',null);const task=store.find(promotion.taskId);if(task?.state==='WAITING_ACCEPTANCE'&&task.metadata.sourceSha===promotion.sourceSha)await pipeline.promote(task);return;}
  if(Date.now()-lastPoll>=config.pollSeconds*1000){await pipeline.ingest();lastPoll=Date.now();}
  const processRequest=store.get('processRequested');
  if(processRequest){await processRequestedFeedback(processRequest);return;}
  if(store.get('sweepRequested')&&store.countRunsToday()<config.maxAgentRunsPerDay){store.set('sweepRequested',false);store.set('phase','用户 Agent 正在体验');store.set('currentWork',{kind:'sweep',startedAt:new Date().toISOString()});store.set('nextSweep',new Date(Date.now()+config.sweepMinutes*60000).toISOString());await pipeline.sweep();store.set('lastError',null);return;}
  if(!store.get('enabled')){store.set('phase','已暂停新任务');return;}
  if(store.countRunsToday()>=config.maxAgentRunsPerDay){store.set('phase','等待明日 Agent 调用额度');return;}
  const backoff=store.get('backoffUntil');if(backoff&&Date.now()<Date.parse(backoff)){store.set('phase','等待自动重试');return;}
  const active=store.active();const next=store.next();
  if(!active&&next&&!processingBlock(config,store,next)){store.set('phase','正在处理反馈');store.set('currentWork',{kind:'task',taskId:next.id,title:next.title,startedAt:new Date().toISOString()});await pipeline.processTask(next);return;}
  const nextSweep=store.get('nextSweep');
  if((!nextSweep||Date.now()>=Date.parse(nextSweep))&&store.countRunsToday()<config.maxAgentRunsPerDay){store.set('phase','用户 Agent 正在体验');store.set('currentWork',{kind:'sweep',startedAt:new Date().toISOString()});store.set('nextSweep',new Date(Date.now()+config.sweepMinutes*60000).toISOString());await pipeline.sweep();store.set('lastError',null);return;}
  store.set('phase',active?.state==='WAITING_ACCEPTANCE'?'等待两名真人验收':next?'等待每日处理额度':'等待下一次巡检');
 }catch(error){const retryAt=new Date(Date.now()+5*60000).toISOString();if(store.get('phase')==='用户 Agent 正在体验')store.set('nextSweep',retryAt);store.set('lastError',{message:error.message,at:new Date().toISOString()});store.event(null,'error',error.message);store.set('backoffUntil',retryAt);if(!store.get('appReady'))bootRetry=Date.now()+5*60000;console.error(error.message);}
 finally{if(!closing)store.set('currentWork',null);busy=false;}
}
timer=setInterval(tick,3000);process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);process.on('uncaughtException',error=>{console.error(error);process.exitCode=1;pipeline.abort.abort();clearInterval(timer);clearInterval(heartbeat);apps.stopAll().finally(()=>{server.close();store.release(owner);store.close();process.exit(1);});});
console.log(`WorkTrace 自动优化服务：http://127.0.0.1:${config.controlPort}`);await tick();
