import path from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,existsSync,cpSync,readdirSync,realpathSync} from 'node:fs';
import {callAgent} from './codex.mjs';
import {userPrompt,triagePrompt,developerPrompt,reviewerPrompt,qaPrompt} from './prompts.mjs';
import {git,integrationHead,checkout,commitCandidate,relatedContext,allowedPath,unsafeDiffReason} from './git.mjs';
import {appDatabase} from './local-app.mjs';
import {checkCandidate,buildFingerprint,checkFailureLogs} from './checks.mjs';
import {taskFailureAction,callFailureLimit} from './retry.mjs';
import {canContinueTask} from './task-policy.mjs';
import {qaPlan} from './task-memory.mjs';
const safeScope=/^src\/(?:components\/(?!rsi|console-shell|account|language-toggle|feedback-list)[\w/\[\]-]+(?:\.test)?(?:\.tsx?)?|app\/console\/(?:logs|feedback)(?:\/[\w/\[\]-]+(?:\.test)?(?:\.tsx?)?)?|lib\/(?:feedback[\w.-]*|markdown[\w.-]*)\.ts)$/;
const json=(filename,value)=>writeFileSync(filename,JSON.stringify(value,null,2));
export class Pipeline{
 constructor(config,store,apps,users){Object.assign(this,{config,store,apps,users});this.abort=new AbortController();}
 async updateFeedback(task,status,reply,options={}){const db=await appDatabase(this.config);try{return db.reviewFeedback(task.feedbackId,this.users.adminA.id,{status,reply:reply.slice(0,3000),expectedAgentRevision:task.metadata.feedbackRevision||0,agentOnly:options.handlingMode!=='HUMAN',...options});}catch(error){if(error.message==='Feedback has changed')error.code='FEEDBACK_HANDOFF_CHANGED';throw error;}finally{db.close();}}
 async migrateFeedbackHandling(){
  if(this.store.get('feedbackHandlingVersion')===1)return;
  const db=await appDatabase(this.config);try{for(const task of this.store.listTasks())if(['CLOSED','ESCALATED','REJECTED'].includes(task.state)){
   let feedback=db.getFeedback(task.feedbackId,this.users.adminA.id);if(feedback?.handlingMode==='AGENT'&&!feedback.agentRevision){const rejection=this.store.approvals(task.id).filter(item=>item.decision==='reject').sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];feedback=db.reviewFeedback(feedback.id,this.users.adminA.id,{status:feedback.status,reply:feedback.reply,handlingMode:'HUMAN',agentInstructions:feedback.agentInstructions||(rejection?`${rejection.userName} 对候选版本 ${rejection.sourceSha} 的验收反馈：\n${rejection.note}`:task.metadata.manualResolution||task.metadata.reason||'')});}
   if(feedback)this.store.syncFeedback(feedback);
  }this.store.set('feedbackHandlingVersion',1);}finally{db.close();}
 }
 async ingest(){const db=await appDatabase(this.config);let stopStage=false;const waiting=this.store.listTasks().find(task=>task.state==='WAITING_ACCEPTANCE');try{
  const seen=new Set();for(const status of ['OPEN','IN_PROGRESS']){let cursor=null;do{const result=db.listFeedback(this.users.adminA.id,{all:true,status,limit:50,cursor});for(const feedback of result.items){seen.add(feedback.id);this.store.syncFeedback(feedback);}cursor=result.nextCursor;}while(cursor);}
  for(const task of this.store.listTasks())if(!seen.has(task.feedbackId)){const feedback=db.getFeedback(task.feedbackId,this.users.adminA.id);if(feedback)this.store.syncFeedback(feedback);else if(task.state!=='CLOSED')this.store.transition(task.id,'CLOSED',{reason:'原反馈已不存在，停止自动处理。',handlingMode:'HUMAN'});}
  stopStage=waiting&&this.store.find(waiting.id)?.state!=='WAITING_ACCEPTANCE';
 }finally{db.close();}if(stopStage){this.store.set('pendingPromotion',null);await this.apps.stop('stage');}}
 async ensureEligible(task){
  const db=await appDatabase(this.config);let feedback;try{feedback=db.getFeedback(task.feedbackId,this.users.adminA.id);}finally{db.close();}
  if(feedback)this.store.syncFeedback(feedback);
  if(!feedback||feedback.handlingMode==='HUMAN'||!['OPEN','IN_PROGRESS'].includes(feedback.status)||(feedback.agentRevision||0)!==(task.metadata.feedbackRevision||0)){
   if(!feedback)this.store.transition(task.id,'CLOSED',{reason:'原反馈已不存在，停止自动处理。',handlingMode:'HUMAN'});
   this.store.set('pendingPromotion',null);await this.apps.stop('stage');
   const error=Error('反馈处理方式或补充要求已更新，停止旧周期，保留已有代码。');error.code='FEEDBACK_HANDOFF_CHANGED';throw error;
  }
 }
 async taskAgent(task,options){return callAgent(this.config,this.store,{...options,beforeAttempt:()=>this.ensureEligible(task)});}
 async sweep(){const {config,store}=this;const missions=['准备提交一条建议，写到一半需要去核对自己的日志详情，再返回继续补充。','新建日志，编写标题、编号列表、缩进和待办，切页及刷新后继续填写。','复制昨天的日志，修改今天的工作内容，保存后在详情核对。','准备一条反馈，检查必填项和失败后继续修改、成功后的状态。'];const index=store.get('sweepIndex',0);const id=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,17),directory=path.join(config.home,'observations',id);const answer=await callAgent(config,store,{role:'user',cwd:config.projectRoot,directory,prompt:userPrompt(config,store.listTasks())+`\nThis sweep's user scenario (not an expected finding): ${missions[index%missions.length]}\nWrite visible conclusions in Chinese. Compare screenshots before claiming a visual bug; editor accessibility snapshots can include hidden Markdown markers.`,browser:{url:config.appUrl,channel:config.browserChannel,evidenceDir:path.join(directory,'browser')},signal:this.abort.signal});store.set('sweepIndex',index+1);store.set('lastSweep',{at:new Date().toISOString(),answer,directory});store.event(null,'sweep_finished',answer.summary,{directory,feedbackSubmitted:answer.feedbackSubmitted});await this.ingest();}
 async rejectToHuman(task,reason,detail={}){await this.ensureEligible(task);this.store.transition(task.id,'ESCALATED',{reason,handlingMode:'HUMAN',...detail});await this.updateFeedback(task,'IN_PROGRESS',`自动处理已暂停，需人工判断：${reason}`,{handlingMode:'HUMAN'});}
 async prepareTask(task,directory){
  const {config,store}=this;
  let scope=task.metadata.scopeFiles,acceptance=task.metadata.acceptance;
  if(!scope||!acceptance){
   store.transition(task.id,'TRIAGING');
   const triage=await this.taskAgent(task,{role:'triage',taskId:task.id,cwd:config.projectRoot,directory:path.join(directory,`triage-${task.metadata.retryAttempt||0}`),prompt:triagePrompt(task,store.listTasks()),signal:this.abort.signal});
   await this.ensureEligible(task);
   if(triage.decision==='DUPLICATE'){const duplicate=store.find(triage.duplicateOf);if(!duplicate){await this.rejectToHuman(task,'去重目标不存在，需人工判断。');return null;}store.transition(task.id,'REJECTED',{reason:triage.summary,duplicateOf:duplicate.id});await this.updateFeedback(task,'DECLINED',`已归入同类反馈：${duplicate.title}`);return null;}
   if(triage.decision!=='IMPLEMENT'){await this.rejectToHuman(task,triage.summary||'反馈范围需要人工确认。');return null;}
   scope=triage.scopeFiles;acceptance=triage.acceptance;
  }
  if(!Array.isArray(scope)||!scope.length||scope.length>config.maxChangedFiles||scope.some(file=>typeof file!=='string'||!safeScope.test(file)||!allowedPath(file,[file]))||!Array.isArray(acceptance)||!acceptance.length)throw Error('反馈范围或验收要求不合法，需人工确认。');
  task=store.transition(task.id,'DEVELOPING',{scopeFiles:scope,acceptance});
  const baseSha=await integrationHead(config),used=store.repairRoundsUsed(task.id);
  let previous=null;
  if(task.metadata.worktree&&existsSync(task.metadata.worktree)){
   previous=realpathSync(task.metadata.worktree);
   if(!previous.startsWith(realpathSync(path.join(config.home,'worktrees'))+path.sep))throw Error('保存的任务目录不在本地运行范围内。');
  }
  let stage=task.metadata.resumeStage||'DEVELOPING',round=task.metadata.resumeRound||used+1,worktree=previous;
  if(!previous||task.metadata.baseSha!==baseSha){
   worktree=await checkout(config,`task-${task.id.slice(0,12)}-${baseSha.slice(0,8)}-${task.metadata.retryAttempt||0}`,baseSha,{branch:true});
   if(previous&&task.metadata.baseSha){
    if(await git(config,['status','--porcelain','-uall'],previous))await commitCandidate(config,task,previous);
    const patch=await git(config,['diff','--no-ext-diff','--unified=3',task.metadata.baseSha,'HEAD'],previous);
    const files=(await git(config,['diff','--name-only',task.metadata.baseSha,'HEAD'],previous)).split('\n').filter(Boolean),changeKinds=await git(config,['diff','--name-status',task.metadata.baseSha,'HEAD'],previous);
    if(files.length>config.maxChangedFiles||Buffer.byteLength(patch)>config.maxDiffBytes||files.some(file=>!allowedPath(file,scope))||/^[DR]/m.test(changeKinds)||/(?:new file|new) mode 120000/.test(patch)||unsafeDiffReason(patch)||/(?:wtk_|fmtopat_|mob_)[a-zA-Z0-9_-]{15,}|sk-[a-zA-Z0-9_-]{20,}/.test(patch))throw Error('保存的候选改动超出范围或存在风险，需人工审查。');
    if(patch){
     const patchFile=path.join(directory,`preserved-${baseSha.slice(0,12)}.patch`);writeFileSync(patchFile,patch+'\n');
     await git(config,['apply','--check',patchFile],worktree);await git(config,['apply',patchFile],worktree);
     const candidate=await commitCandidate(config,task,worktree);
     if(['VERIFYING','REVIEWING','STAGING'].includes(stage))stage='VERIFYING';
     task=store.transition(task.id,stage,{sourceSha:candidate.sourceSha,checks:null,review:null,qa:null});
     store.event(task.id,'candidate_preserved','已将已有候选代码迁移到当前本地基线，保留修复轮次并重新检查。',{sourceSha:candidate.sourceSha});
    }else if(stage!=='DEVELOPING'){stage='DEVELOPING';round=used+1;}
   }
  }
  task=store.transition(task.id,stage,{baseSha,worktree,resumeStage:stage,resumeRound:round,reason:`继续${{DEVELOPING:'代码修复',VERIFYING:'代码检查',REVIEWING:'独立评审',STAGING:'浏览器复测'}[stage]||'处理反馈'}，已有成果和历史记录保留。`});
  await this.updateFeedback(task,'IN_PROGRESS','自动优化正在处理；已有代码、检查记录和评审意见会在调用恢复后继续使用。');
  return task;
 }
 async processTask(task){
  const {config,store}=this;const directory=path.join(config.home,'tasks',task.id);mkdirSync(directory,{recursive:true});
  try{
   task=store.find(task.id);
   await this.ensureEligible(task);
   task=store.hydrateFailureMemory(task.id);
   if(!canContinueTask(task,store.repairRoundsUsed(task.id),config.maxRepairRounds))return await this.rejectToHuman(task,`有效代码修复已达到 ${config.maxRepairRounds} 轮上限，连接故障没有计入修复轮次。`);
   task=await this.prepareTask(task,directory);if(!task)return;
   const {baseSha,worktree}=task.metadata;
   let findings=task.metadata.findings||task.metadata.manualResolution&&{stage:'manual',note:task.metadata.manualResolution}||null;
   for(let round=task.metadata.resumeRound;round<=config.maxRepairRounds;round++){
    const roundDir=path.join(directory,`attempt-${task.metadata.retryAttempt||0}`,`round-${round}`);mkdirSync(roundDir,{recursive:true});
    if(task.metadata.resumeStage==='DEVELOPING'){
     task=store.transition(task.id,'DEVELOPING',{round,resumeRound:round,repairPending:true,reason:`正在进行第 ${round}/${config.maxRepairRounds} 轮代码修复；连接故障单独重试。`});
     const implementation=await this.taskAgent(task,{role:'developer',taskId:task.id,repairRound:round,cwd:worktree,directory:path.join(roundDir,'developer'),prompt:developerPrompt(task,findings),source:{root:worktree,scope:task.metadata.scopeFiles},signal:this.abort.signal});
     await this.ensureEligible(task);
     const changed=await git(config,['status','--porcelain','-uall'],worktree);
     if(implementation.blockedReason){task=store.rememberFailure(task.id,'developer',implementation);if(!changed)return await this.rejectToHuman(task,implementation.blockedReason,{repairPending:false,resumeStage:null});store.event(task.id,'developer_validation_pending','开发 Agent 提出了待验证说明；已有改动先走检查与独立评审，未直接转人工。',{note:implementation.blockedReason});}
     if(!changed){
      findings={stage:'implementation',summary:'上一轮未产生代码改动，请重新核对原始问题和具体评审意见。'};
      task=store.transition(task.id,'DEVELOPING',{findings,resumeStage:'DEVELOPING',resumeRound:round+1,repairPending:false,reason:findings.summary});continue;
     }
     const nextCandidate=await commitCandidate(config,task,worktree);
     task=store.transition(task.id,'VERIFYING',{sourceSha:nextCandidate.sourceSha,files:nextCandidate.files,resumeStage:'VERIFYING',repairPending:false,checks:null,review:null,verificationAttempts:0,lastCallFailure:null});
    }
    const candidate={sourceSha:task.metadata.sourceSha,files:task.metadata.files,diff:await git(config,['diff','--no-ext-diff','--unified=3',baseSha,task.metadata.sourceSha],worktree)};
    if(await git(config,['rev-parse','HEAD'],worktree)!==candidate.sourceSha||await git(config,['status','--porcelain'],worktree))throw Error('保存的候选代码版本已改变，禁止继续检查或部署。');
    const draft={kind:'LOCAL_PR_DRAFT',remotePrCreated:false,state:'VERIFYING',feedbackId:task.feedbackId,title:task.title,baseSha,sourceSha:candidate.sourceSha,files:candidate.files};json(path.join(roundDir,'local-pr.json'),draft);json(path.join(directory,'local-pr.json'),draft);writeFileSync(path.join(roundDir,'candidate.patch'),candidate.diff);writeFileSync(path.join(directory,'candidate.patch'),await git(config,['diff','--no-ext-diff','--unified=3',baseSha,candidate.sourceSha],worktree));
    let checks=task.metadata.checks;
    let reusable=checks?.passed&&checks.sourceSha===candidate.sourceSha&&existsSync(path.join(worktree,'.next/BUILD_ID'));
    if(reusable)try{reusable=checks.artifactHash===buildFingerprint(worktree);}catch{reusable=false;}
    if(!reusable){
     task=store.transition(task.id,'VERIFYING',{resumeStage:'VERIFYING'});
     checks=await checkCandidate(config,worktree,path.join(roundDir,'checks'),{signal:this.abort.signal});store.event(task.id,'checks',checks.passed?'四项检查通过':'检查未通过',{sourceSha:candidate.sourceSha,checks});
     await this.ensureEligible(task);
     task=store.transition(task.id,'VERIFYING',{checks});
    }
    if(!checks.passed){
     findings={stage:'checks',checks,logs:checkFailureLogs(checks,path.join(roundDir,'checks'))};
     store.rememberFailure(task.id,'checks',{...checks,summary:'代码检查未通过，具体断言及错误日志已保存。',logs:findings.logs});
     task=store.transition(task.id,'VERIFYING',{findings,resumeStage:'DEVELOPING',resumeRound:round+1,repairPending:false,reason:'代码检查未通过，下一轮只修复实际失败项。'});continue;
    }
    if(checks.tests.total<store.get('baselineChecks').tests.total)throw Error('测试数量低于基线，需人工判断。');
    const completeDiff=await git(config,['diff','--no-ext-diff','--unified=3',baseSha,candidate.sourceSha],worktree);
    const allFiles=(await git(config,['diff','--name-only',baseSha,candidate.sourceSha],worktree)).split('\n');
    if(allFiles.length>config.maxChangedFiles||Buffer.byteLength(completeDiff)>config.maxDiffBytes||allFiles.some(file=>!allowedPath(file,task.metadata.scopeFiles)))throw Error('累计变更超出范围或规模限制，已转人工。');
    let review=task.metadata.review;
    if(review?.verdict!=='Approve'||review.sourceSha!==candidate.sourceSha){
     task=store.transition(task.id,'REVIEWING',{resumeStage:'REVIEWING'});
     review=await this.taskAgent(task,{role:'reviewer',taskId:task.id,cwd:config.projectRoot,directory:path.join(roundDir,'reviewer'),prompt:reviewerPrompt(task,candidate.sourceSha,completeDiff,relatedContext(worktree,allFiles),checks),signal:this.abort.signal});
     await this.ensureEligible(task);
     task=store.transition(task.id,'REVIEWING',{review,lastCallFailure:null});
    }
    if(review.sourceSha!==candidate.sourceSha)throw Error('评审版本与检查版本不一致。');
    store.event(task.id,'review',review.summary,{verdict:review.verdict,sourceSha:review.sourceSha});
    if(review.verdict!=='Approve')store.rememberFailure(task.id,'review',review);
    if(review.verdict==='Escalate')return await this.rejectToHuman(task,review.summary,{resumeStage:null,escalationKind:'review'});
    if(review.verdict!=='Approve'){findings={stage:'review',review};task=store.transition(task.id,'REVIEWING',{findings,reviewHistory:[...(task.metadata.reviewHistory||[]),review].slice(-3),resumeStage:'DEVELOPING',resumeRound:round+1,repairPending:false,reason:review.summary});continue;}
    if(await git(config,['rev-parse','HEAD'],worktree)!==candidate.sourceSha||await git(config,['status','--porcelain'],worktree)||checks.artifactHash!==buildFingerprint(worktree))throw Error('评审后的代码或构建产物发生变化，禁止部署。');
    task=store.transition(task.id,'STAGING',{resumeStage:'STAGING'});
    await this.ensureEligible(task);
    const release=await this.release(worktree,candidate.sourceSha,checks.artifactHash);await this.apps.start('stage',release);
    const plan=qaPlan(task);
    const qa=await this.taskAgent(task,{role:'qa',taskId:task.id,cwd:config.projectRoot,directory:path.join(roundDir,'qa'),prompt:qaPrompt(task,config.stageUrl),browser:{url:config.stageUrl,channel:config.browserChannel,evidenceDir:path.join(roundDir,'qa/browser'),testFixtures:true,fixtureModes:plan.permittedFixtures,maySubmitFeedback:plan.maySubmitFeedback},signal:this.abort.signal});
    await this.ensureEligible(task);
    const evidenceDir=qa._rsiEvidenceDir;const actualEvidence=evidenceDir&&existsSync(evidenceDir)?readdirSync(evidenceDir).filter(name=>name.endsWith('.png')):[];
    const unrelatedChecks=!plan.maySubmitFeedback&&!plan.permittedFixtures.includes('server_error_on')?(qa.checks||[]).filter(item=>/503|server_error|feedback.{0,15}(?:form|submission)|反馈.{0,10}(?:表单|提交)/i.test(item.name)):[];
    if(unrelatedChecks.length){qa.passed=false;qa.failureKind='tooling';qa.summary='复测包含未批准的反馈表单检查，需按当前任务范围重新验证；不要求开发修改无关页面。';}
    store.event(task.id,'browser_check',qa.summary,{sourceSha:candidate.sourceSha,passed:qa.passed,evidence:actualEvidence});
    for(const observation of qa.observations||[])store.event(task.id,'qa_observation',`额外观察（不阻断本任务）：${observation.summary}`,{evidence:observation.evidence});
    if(qa.passed!==true||!Array.isArray(qa.checks)||!qa.checks.length||qa.checks.some(item=>item.passed!==true)||!actualEvidence.length){
     store.rememberFailure(task.id,'browser',qa,{evidenceDir});findings={stage:'browser',qa,evidenceDir};
     if(qa.failureKind==='tooling'||!actualEvidence.length||!Array.isArray(qa.checks)||!qa.checks.length){
      const attempts=(task.metadata.verificationAttempts||0)+1;
      if(attempts>=config.maxStageAttempts)return await this.rejectToHuman(task,`验证工具连续 ${attempts} 次无法确认结果，代码和已通过的评审保留；未要求开发 Agent 重复修改业务代码：${qa.summary}`,{findings,verificationAttempts:attempts,resumeStage:'STAGING',escalationKind:'verification_tooling'});
      store.transition(task.id,'QUEUED',{findings,verificationAttempts:attempts,resumeStage:'STAGING',resumeRound:round,repairPending:false,reason:`验证工具暂未取得证据，将只重试浏览器验证（${attempts}/${config.maxStageAttempts}），不占代码修复轮次。`});store.set('backoffUntil',new Date(Date.now()+30000).toISOString());return;
     }
     task=store.transition(task.id,'STAGING',{findings,resumeStage:'DEVELOPING',resumeRound:round+1,repairPending:false,reason:qa.summary});await this.apps.stop('stage');continue;
    }
    const acceptedDraft={kind:'LOCAL_PR_DRAFT',remotePrCreated:false,baseSha,sourceSha:candidate.sourceSha,title:task.title,feedbackId:task.feedbackId,files:allFiles,checks,review,qa};json(path.join(directory,'local-pr.json'),acceptedDraft);writeFileSync(path.join(directory,'candidate.patch'),completeDiff);
    store.transition(task.id,'WAITING_ACCEPTANCE',{sourceSha:candidate.sourceSha,release,artifactHash:checks.artifactHash,stageUrl:config.stageUrl,checks,review,qa,resumeStage:null,repairPending:false,lastCallFailure:null,reason:'本地测试版已就绪，等待两名不同账号的真人验收。'});
    await this.updateFeedback(task,'IN_PROGRESS','候选版已通过检查、独立评审和浏览器复测，等待两名真人验收。');store.event(task.id,'notification','本地测试版就绪，请两名真人验收。',{url:config.appUrl+'/console/admin/rsi',stageUrl:config.stageUrl});return;
   }
   await this.rejectToHuman(task,`有效代码修复已完成 ${config.maxRepairRounds} 轮，仍有未解决的问题，保留全部证据并转人工；调用故障单独计数。`,{findings,resumeStage:null,repairPending:false,escalationKind:'repair_limit'});
  }catch(error){if(error.code==='FEEDBACK_HANDOFF_CHANGED')return;try{await this.ensureEligible(task);}catch(handoff){if(handoff.code==='FEEDBACK_HANDOFF_CHANGED')return;throw handoff;}task=store.find(task.id);const failure=taskFailureAction(task,error,{aborted:this.abort.signal.aborted,maxInfrastructureFailures:callFailureLimit(config,task),infrastructureFailures:store.callFailures(task.id)});if(failure.state==='QUEUED'){store.transition(task.id,'QUEUED',failure.metadata);await this.updateFeedback(task,'IN_PROGRESS',failure.metadata.reason).catch(()=>{});}else await this.rejectToHuman(task,failure.metadata.reason,failure.metadata).catch(handoff=>{if(handoff.code!=='FEEDBACK_HANDOFF_CHANGED')store.transition(task.id,'ESCALATED',failure.metadata);});throw error;}
 }
 async release(source,sha,fingerprint){const target=await checkout(this.config,`release-${sha.slice(0,12)}`,sha);if(!existsSync(path.join(target,'.next'))){const root=path.join(source,'.next');cpSync(root,path.join(target,'.next'),{recursive:true,filter:file=>!path.relative(root,file).split(path.sep).includes('cache')});}if(buildFingerprint(target)!==fingerprint)throw Error('部署产物与检查产物不一致。');return target;}
 async accept(task,actor,sha,decision,note){
  if(!['approve','reject'].includes(decision))throw Error('无效的验收结果。');
  if(decision==='reject'&&task.state!=='WAITING_ACCEPTANCE'&&this.store.approvals(task.id).some(item=>item.sourceSha===sha&&item.decision==='reject'))return;
  await this.ensureEligible(task);
  if(decision==='reject'&&note.trim().length<8)throw Error('请至少填写 8 字，说明验收未通过的原因、复现步骤或期望效果，Agent 将据此继续修复。');
  const approvals=this.store.approve(task.id,actor,sha,decision,note);
  if(decision==='reject'){
   const feedback=await this.updateFeedback(task,'IN_PROGRESS',`真人验收未通过，已交回 Agent 修复：${note}`,{handlingMode:'AGENT',requestAgent:true,agentInstructions:`${actor.name} 对候选版本 ${sha} 的验收反馈：\n${note}`,agentRequestKey:`acceptance:${sha}`});
   this.store.syncFeedback(feedback);this.store.set('pendingPromotion',null);
   await this.apps.stop('stage');this.store.event(task.id,'acceptance_repair_queued','已保存验收意见并交回 Agent；自动运行暂停时可手动处理。',{sourceSha:sha,note});return;
  }
  const passed=approvals.filter(item=>item.sourceSha===sha&&item.decision==='approve');if(new Set(passed.map(item=>item.userId)).size<2)return;
  this.store.set('pendingPromotion',{taskId:task.id,sourceSha:sha});this.store.event(task.id,'promotion_queued','两名验收人已通过，等待服务空闲后更新本地版本。');
 }
 async promote(task){
  const sha=task.metadata.sourceSha;
  if(task.state!=='WAITING_ACCEPTANCE')return;
  await this.ensureEligible(task);
  const approvals=this.store.approvals(task.id).filter(item=>item.sourceSha===sha&&item.decision==='approve');
  if(new Set(approvals.map(item=>item.userId)).size<2)throw Error('尚未得到两名不同验收人批准。');
  if(await integrationHead(this.config)!==task.metadata.baseSha||buildFingerprint(task.metadata.release)!==task.metadata.artifactHash)throw Error('集成基线或构建产物变化，禁止自动合并。');
  const previous=this.store.get('currentRelease');let refUpdated=false;
  try{
   await this.apps.start('baseline',task.metadata.release);
   await this.ensureEligible(task);
   await git(this.config,['update-ref',this.config.integrationRef,sha,task.metadata.baseSha]);refUpdated=true;
   this.store.set('currentRelease',{sourceSha:sha,root:task.metadata.release});this.store.set('baselineChecks',task.metadata.checks);this.store.transition(task.id,'ACCEPTED',{reason:'两名真人已验收，通过本地集成；未发布生产环境。'});await this.updateFeedback(task,'COMPLETED','两名真人验收通过，已更新本地集成版本。');
  }catch(error){
   if(refUpdated)await git(this.config,['update-ref',this.config.integrationRef,task.metadata.baseSha,sha]);
   if(previous){try{await this.apps.start('baseline',previous.root);this.store.set('currentRelease',previous);}catch{this.store.set('appReady',false);}}
   if(error.code==='FEEDBACK_HANDOFF_CHANGED')return;
   await this.rejectToHuman(task,`本地集成未完成，已尝试恢复上一版：${error.message}`);throw error;
  }
 }
}
