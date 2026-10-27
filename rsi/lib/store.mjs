import Database from 'better-sqlite3';
import {randomUUID,createHash} from 'node:crypto';
import {taskPolicy} from './task-policy.mjs';
import {failureRecord} from './task-memory.mjs';
import {agentEligibleFeedback} from './feedback-policy.mjs';
const terminal=['ACCEPTED','REJECTED','ESCALATED','CLOSED'];
export class Store{
 constructor(filename){this.db=new Database(filename);this.db.pragma('journal_mode=WAL');this.db.pragma('busy_timeout=5000');this.db.exec(`
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,feedback_id TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS task_state ON tasks(state,created_at);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT,type TEXT NOT NULL,message TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,task_id TEXT,role TEXT NOT NULL,state TEXT NOT NULL,metadata TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT);
 CREATE TABLE IF NOT EXISTS approvals(task_id TEXT NOT NULL,user_id TEXT NOT NULL,user_name TEXT NOT NULL,source_sha TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(task_id,user_id,source_sha));
 CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires INTEGER NOT NULL);
 `);}
 get(key,fallback=null){const row=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):fallback;}
 set(key,value){this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
 acquire(owner,ttl=30000){return this.db.transaction(()=>{const row=this.db.prepare('SELECT * FROM lease WHERE id=1').get();if(row&&row.expires>Date.now()&&row.owner!==owner)return false;this.db.prepare('INSERT INTO lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires').run(owner,Date.now()+ttl);return true;})();}
 renew(owner){const result=this.db.prepare('UPDATE lease SET expires=? WHERE id=1 AND owner=?').run(Date.now()+30000,owner);if(!result.changes)throw Error('Runtime lease lost.');this.set('heartbeat',new Date().toISOString());}
 release(owner){this.db.prepare('DELETE FROM lease WHERE owner=?').run(owner);}
 event(taskId,type,message,detail={}){this.db.prepare('INSERT INTO events(task_id,type,message,detail,created_at) VALUES(?,?,?,?,?)').run(taskId,type,message,JSON.stringify(detail),new Date().toISOString());}
 task(row){return row?{id:row.id,feedbackId:row.feedback_id,fingerprint:row.fingerprint,state:row.state,title:row.title,description:row.description,category:row.category,metadata:JSON.parse(row.metadata),createdAt:row.created_at,updatedAt:row.updated_at}:null;}
 listTasks(){return this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100').all().map(row=>this.task(row));}
 find(id){return this.task(this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id));}
 enqueue(feedback){const fingerprint=createHash('sha256').update(`${feedback.title.trim().toLowerCase()}\n${feedback.description.trim()}`).digest('hex');const previous=this.db.prepare('SELECT id FROM tasks WHERE feedback_id=?').get(feedback.id);if(previous)return null;const related=this.db.prepare('SELECT id FROM tasks WHERE fingerprint=?').all(fingerprint).map(row=>row.id),now=new Date().toISOString(),id=randomUUID();this.db.prepare('INSERT INTO tasks(id,feedback_id,fingerprint,state,title,description,category,metadata,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,feedback.id,fingerprint,'QUEUED',feedback.title,feedback.description,feedback.category,JSON.stringify({relatedTaskIds:related}),now,now);this.event(id,'queued','已从建议反馈加入队列；相似内容仅关联记录，不阻止执行。',{relatedTaskIds:related});return this.find(id);}
 syncFeedback(feedback){
  let task=this.task(this.db.prepare('SELECT * FROM tasks WHERE feedback_id=?').get(feedback.id));
  const eligible=agentEligibleFeedback(feedback),revision=feedback.agentRevision||0;
  if(!task){if(!eligible)return null;task=this.enqueue(feedback);if(!task)return null;return this.transition(task.id,'QUEUED',{feedbackRevision:revision,repairCycle:revision,handlingMode:'AGENT',feedbackStatus:feedback.status,agentInstructions:feedback.agentInstructions||''});}
  if(!eligible){
   const state=['ACCEPTED','ESCALATED','REJECTED','CLOSED'].includes(task.state)?task.state:'CLOSED',reason=['ESCALATED','REJECTED'].includes(task.state)&&feedback.handlingMode==='HUMAN'?task.metadata.reason:feedback.handlingMode==='HUMAN'?'已标记人工处理，Agent 跳过此建议。':'反馈已完成，Agent 跳过此建议。';
   if(task.state!==state||task.metadata.handlingMode!==feedback.handlingMode||task.metadata.feedbackStatus!==feedback.status||task.metadata.agentInstructions!==(feedback.agentInstructions||''))return this.transition(task.id,state,{handlingMode:feedback.handlingMode,feedbackStatus:feedback.status,agentInstructions:feedback.agentInstructions||'',reason});
   return task;
  }
  if(revision>(task.metadata.feedbackRevision||0)){
   task=this.hydrateFailureMemory(task.id);
   const history=[...(task.metadata.cycleHistory||[]),{cycle:task.metadata.repairCycle||0,state:task.state,sourceSha:task.metadata.sourceSha,used:this.repairRoundsUsed(task.id),instructions:task.metadata.agentInstructions,scopeFiles:task.metadata.scopeFiles,acceptance:task.metadata.acceptance,findings:task.metadata.findings,review:task.metadata.review,qa:task.metadata.qa,reason:task.metadata.reason,at:new Date().toISOString()}];
   const resetAccepted=task.state==='ACCEPTED'?{worktree:null,baseSha:null,sourceSha:null,files:null}:{};
   task=this.transition(task.id,'QUEUED',{...resetAccepted,feedbackRevision:revision,repairCycle:revision,handlingMode:'AGENT',feedbackStatus:feedback.status,agentInstructions:feedback.agentInstructions||'',cycleHistory:history,previousScopeFiles:task.metadata.scopeFiles||task.metadata.previousScopeFiles,scopeFiles:null,acceptance:null,scopePreflightComplete:false,scopeRepairCount:0,pendingScopeRequest:null,checks:null,review:null,qa:null,release:null,stageUrl:null,pendingPromotion:null,findings:{stage:'human',summary:feedback.agentInstructions},resumeStage:'DEVELOPING',resumeRound:1,repairPending:false,noChangeValidation:null,readOnlyContextRetries:0,readOnlyContextFiles:[],manualRetryCount:0,recoveryAttempts:0,infrastructureRetries:0,lastCallFailure:null,retryAttempt:(task.metadata.retryAttempt||0)+1,reason:'已收到人工补充要求，重新筛选范围后继续修复；原代码和历史记录保留。'});
   this.event(task.id,'feedback_revision','已将人工反馈交回 Agent，创建有限修复周期。',{revision,instructions:feedback.agentInstructions});return task;
  }
  if(['REJECTED','CLOSED'].includes(task.state)&&task.metadata.duplicateOf&&!task.metadata.duplicatePolicyMigrated&&this.repairRoundsUsed(task.id)<3)return this.transition(task.id,'QUEUED',{duplicatePolicyMigrated:true,duplicateOf:null,handlingMode:feedback.handlingMode,feedbackStatus:feedback.status,agentInstructions:feedback.agentInstructions||'',reason:'未完成的重复建议已恢复排队，将继续按原始需求处理。'});
  if(task.metadata.handlingMode!==feedback.handlingMode||task.metadata.feedbackStatus!==feedback.status||task.metadata.agentInstructions!==(feedback.agentInstructions||''))return this.transition(task.id,task.state,{handlingMode:feedback.handlingMode,feedbackStatus:feedback.status,agentInstructions:feedback.agentInstructions||''});
  return task;
 }
 transition(id,state,patch={}){const current=this.find(id);if(!current)throw Error('Task not found.');this.db.prepare('UPDATE tasks SET state=?,metadata=?,updated_at=? WHERE id=?').run(state,JSON.stringify({...current.metadata,...patch}),new Date().toISOString(),id);this.event(id,'state',state,{previous:current.state});return this.find(id);}
 rememberFailure(taskId,kind,answer,context={}){
  const task=this.find(taskId);if(!task)return null;
  const entry=failureRecord(kind,answer,{cycle:task.metadata.repairCycle||0,round:task.metadata.resumeRound,sourceSha:task.metadata.sourceSha,...context});
  if(!entry)return task;
  const memory=task.metadata.failureMemory||[];if(memory.some(item=>item.id===entry.id))return task;
  this.db.prepare('UPDATE tasks SET metadata=? WHERE id=?').run(JSON.stringify({...task.metadata,failureMemory:[...memory,entry]}),taskId);
  return this.find(taskId);
 }
 hydrateFailureMemory(taskId){
  for(const row of this.db.prepare("SELECT role,metadata,started_at FROM runs WHERE task_id=? AND state='COMPLETED' AND role IN ('reviewer','qa','developer') ORDER BY started_at").all(taskId)){
   const metadata=JSON.parse(row.metadata),answer=metadata.answer;if(!answer||row.role==='developer'&&!answer.blockedReason)continue;
   this.rememberFailure(taskId,row.role==='reviewer'?'review':row.role==='qa'?'browser':'developer',answer,{cycle:metadata.repairCycle||0,round:metadata.repairRound??(Number(/round-(\d+)/.exec(metadata.directory||'')?.[1])||null),sourceSha:metadata.sourceSha||answer.sourceSha||null,at:row.started_at,evidenceDir:metadata.directory||null});
  }
  return this.find(taskId);
 }
 active(){return this.listTasks().find(task=>!terminal.includes(task.state)&&task.state!=='QUEUED');}
 next(){return this.task(this.db.prepare("SELECT * FROM tasks WHERE state='QUEUED' ORDER BY created_at LIMIT 1").get());}
 recover(){for(const task of this.listTasks())if(!terminal.includes(task.state)&&!['QUEUED','WAITING_ACCEPTANCE'].includes(task.state)){const recoveryAttempts=(task.metadata.recoveryAttempts||0)+1;this.transition(task.id,recoveryAttempts>3?'ESCALATED':'QUEUED',{recoveryAttempts,retryAttempt:(task.metadata.retryAttempt||0)+1,reason:recoveryAttempts>3?'服务恢复次数过多，保留证据并转人工。':'服务中断后已重新排队；保留原工作目录，从独立目录安全重试。'});}}
 developmentRuns(taskId){return this.db.prepare("SELECT id,state,metadata FROM runs WHERE task_id=? AND role='developer' ORDER BY started_at").all(taskId).map(row=>({...row,metadata:JSON.parse(row.metadata)}));}
 repairRoundsUsed(taskId,{all=false}={}){const cycle=this.find(taskId)?.metadata.repairCycle||0;return new Set(this.developmentRuns(taskId).filter(run=>(all||(run.metadata.repairCycle||0)===cycle)&&run.metadata.repairCharge!==false).map(run=>Number.isInteger(run.metadata.repairRound)?`${run.metadata.repairCycle||0}:round:${run.metadata.repairRound}`:run.id)).size;}
 callFailures(taskId){const cycle=this.find(taskId)?.metadata.repairCycle||0;return this.db.prepare("SELECT metadata FROM runs WHERE task_id=? AND state='FAILED'").all(taskId).filter(row=>{const metadata=JSON.parse(row.metadata);return metadata.retryable===true&&(metadata.repairCycle||0)===cycle;}).length;}
 repairStats(taskId){const runs=this.developmentRuns(taskId),cycle=this.find(taskId)?.metadata.repairCycle||0;return {used:this.repairRoundsUsed(taskId),cycle,totalUsed:this.repairRoundsUsed(taskId,{all:true}),developerCalls:runs.filter(run=>(run.metadata.repairCycle||0)===cycle).length,totalDeveloperCalls:runs.length,callFailures:this.callFailures(taskId)};}
 retryTask(taskId,actor,note,limit=3){return this.db.transaction(()=>{const task=this.find(taskId);if(!task)throw Error('任务不存在。');const policy=taskPolicy(task,this.repairRoundsUsed(taskId),limit);if(!policy.retryAllowed)throw Error(policy.retryDisabledReason);if(typeof note!=='string'||note.trim().length<8||note.length>1000)throw Error('请至少填写 8 字，说明已经排除的原因或补充的处理方案。');const next=this.transition(taskId,'QUEUED',{retryAttempt:(task.metadata.retryAttempt||0)+1,manualRetryCount:policy.manualRetries+1,manualResolution:note.trim(),reason:'已补充处理方案，等待恢复；累计开发次数不会清零。'});this.event(taskId,'manual_retry',`${actor.name} 补充方案后恢复任务`,{note:note.trim(),used:policy.used,remaining:policy.remaining});return next;})();}
 startRun(taskId,role,metadata={},limit=3){return this.db.transaction(()=>{const cycle=this.find(taskId)?.metadata.repairCycle||0;metadata={...metadata,repairCycle:cycle};const continuing=Number.isInteger(metadata.repairRound)&&metadata.repairRound<=limit&&this.developmentRuns(taskId).some(run=>run.metadata.repairRound===metadata.repairRound&&(run.metadata.repairCycle||0)===cycle);if(role==='developer'&&(!taskId||this.repairRoundsUsed(taskId)>=limit&&!continuing)){const error=Error(`有效代码修复已达到 ${limit} 轮上限，需人工处理。`);error.code='REPAIR_LIMIT';throw error;}const id=randomUUID();this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,NULL)').run(id,taskId,role,'RUNNING',JSON.stringify(metadata),new Date().toISOString());return id;})();}
 finishRun(id,state,metadata){this.db.prepare('UPDATE runs SET state=?,metadata=?,finished_at=? WHERE id=?').run(state,JSON.stringify(metadata),new Date().toISOString(),id);}
 countRunsToday(){return this.db.prepare("SELECT count(*) AS n FROM runs WHERE date(started_at,'+8 hours')=date('now','+8 hours')").get().n;}
 countTasksToday(){return this.db.prepare("SELECT count(DISTINCT task_id) AS n FROM runs WHERE role='developer' AND date(started_at,'+8 hours')=date('now','+8 hours')").get().n;}
 taskRanToday(taskId){return Boolean(this.db.prepare("SELECT 1 FROM runs WHERE task_id=? AND role='developer' AND date(started_at,'+8 hours')=date('now','+8 hours') LIMIT 1").get(taskId));}
 approve(taskId,actor,sha,decision,note=''){const task=this.find(taskId);if(!task||task.state!=='WAITING_ACCEPTANCE'||task.metadata.sourceSha!==sha)throw Error('候选版本已变化，请刷新后再验收。');this.db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?,?,?) ON CONFLICT(task_id,user_id,source_sha) DO UPDATE SET decision=excluded.decision,note=excluded.note,created_at=excluded.created_at').run(taskId,actor.id,actor.name,sha,decision,note,new Date().toISOString());this.event(taskId,'human_review',`${actor.name}：${decision==='approve'?'验收通过':'验收不通过'}`,{sourceSha:sha,note});return this.approvals(taskId);}
 approvals(taskId){return this.db.prepare('SELECT user_id AS userId,user_name AS userName,source_sha AS sourceSha,decision,note,created_at AS createdAt FROM approvals WHERE task_id=?').all(taskId);}
 status(){return {heartbeat:this.get('heartbeat'),enabled:this.get('enabled',true),nextSweep:this.get('nextSweep'),lastError:this.get('lastError'),agentRunsToday:this.countRunsToday(),tasksToday:this.countTasksToday(),tasks:this.listTasks().map(task=>({...task,approvals:this.approvals(task.id)})),runs:this.db.prepare('SELECT id,task_id AS taskId,role,state,metadata,started_at AS startedAt,finished_at AS finishedAt FROM runs ORDER BY started_at DESC LIMIT 40').all().map(row=>({...row,metadata:JSON.parse(row.metadata)})),events:this.db.prepare('SELECT id,task_id AS taskId,type,message,detail,created_at AS createdAt FROM events ORDER BY id DESC LIMIT 100').all().map(row=>({...row,detail:JSON.parse(row.detail)}))};}
 close(){this.db.close();}
 recoverRuns(retainedRunId=null){const rows=this.db.prepare("SELECT * FROM runs WHERE state='RUNNING'").all().filter(row=>row.id!==retainedRunId);for(const row of rows){this.finishRun(row.id,'FAILED',{...JSON.parse(row.metadata),error:'上次调用进程已结束但未保存结果；已回收中断状态，未将本轮计为成功。',failureKind:'interrupted',retryable:true});this.event(row.task_id,'agent_interrupted',`${row.role} 上次调用已中断，运行状态已回收。`,{runId:row.id});}return rows;}
}
