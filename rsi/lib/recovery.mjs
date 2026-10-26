import path from 'node:path';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {agentFailure} from './retry.mjs';

// Reclassify only failures with local evidence; unknown historical attempts remain charged.
export function migrateFailureAccounting(config,store){
 const recovered=[];
 const root=realpathSync(config.home)+path.sep;
 const rows=store.db.prepare("SELECT id,task_id AS taskId,role,metadata FROM runs WHERE state='FAILED'").all();
 for(const row of rows){
  const metadata=JSON.parse(row.metadata);
  if(metadata.failureKind||!metadata.directory)continue;
  let directory;try{directory=realpathSync(metadata.directory);}catch{continue;}
  if(!directory.startsWith(root))continue;
  const events=path.join(directory,'events.jsonl');if(!existsSync(events))continue;
  const failure=agentFailure({code:1,out:readFileSync(events,'utf8').slice(-2000000)});
  if(failure.kind!=='transient')continue;
  const trace=path.join(directory,'source-trace.jsonl');
  let writes=false;
  if(existsSync(trace))for(const line of readFileSync(trace,'utf8').trim().split('\n'))try{const event=JSON.parse(line);if(event.action==='write'&&event.ok===true)writes=true;}catch{}
  store.db.prepare('UPDATE runs SET metadata=? WHERE id=?').run(JSON.stringify({...metadata,failureKind:failure.kind,retryable:true,error:failure.message,...(row.role==='developer'?{repairCharge:writes}:{}),accountingVersion:2}),row.id);
  store.event(row.taskId,'failure_reclassified','已按调用记录重新区分连接故障与代码修复，历史记录保留。',{runId:row.id,repairCharged:writes});
 }
 for(const task of store.listTasks()){
  const used=store.repairRoundsUsed(task.id);
  if(task.metadata.handlingMode==='HUMAN'||task.state!=='ESCALATED'||used>=config.maxRepairRounds||!task.metadata.reason?.includes('上限')||!store.callFailures(task.id))continue;
  const runs=store.developmentRuns(task.id),last=runs.at(-1);
  if(last?.state!=='FAILED'||last.metadata.failureKind!=='transient'||last.metadata.repairCharge!==false)continue;
  store.transition(task.id,'QUEUED',{resumeStage:'DEVELOPING',resumeRound:used+1,repairPending:false,escalationKind:null,lastCallFailure:{kind:'transient',message:last.metadata.error,at:task.updatedAt},reason:`历史连接故障已从修复轮次中分离：有效修复 ${used}/${config.maxRepairRounds} 轮，候选代码和评审意见已保留，等待继续。`});
  store.event(task.id,'accounting_recovered','已纠正连接失败误占修复额度，恢复原任务队列；没有清零修复历史。');
  recovered.push(store.find(task.id));
 }
 return recovered;
}
