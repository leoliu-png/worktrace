import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,cpSync,readdirSync,realpathSync} from 'node:fs';
import {callAgent} from './codex.mjs';
import {userPrompt,triagePrompt,scopePrompt,developerPrompt,reviewerPrompt,qaPrompt} from './prompts.mjs';
import {git,integrationHead,checkout,commitCandidate,relatedContext,allowedPath,unsafeDiffReason} from './git.mjs';
import {appDatabase} from './local-app.mjs';
import {checkCandidate,buildFingerprint,checkFailureLogs} from './checks.mjs';
import {taskFailureAction,callFailureLimit} from './retry.mjs';
import {canContinueTask} from './task-policy.mjs';
import {qaPlan} from './task-memory.mjs';
import {agentEligibleFeedback,unfinishedFeedbackStatuses,nonBlockingTriageDecision} from './feedback-policy.mjs';
import {automatableScope,validScopePlan as validPlan,planningContext} from './scope-policy.mjs';
import {recordLocalUpdate,localUpdateActive} from './local-update.mjs';
import {qaToolVersion} from './qa-capabilities.mjs';
import {sourceAccess} from './source-access.mjs';
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
  const seen=new Set();for(const status of unfinishedFeedbackStatuses){let cursor=null;do{const result=db.listFeedback(this.users.adminA.id,{all:true,status,limit:50,cursor});for(const feedback of result.items){seen.add(feedback.id);this.store.syncFeedback(feedback);}cursor=result.nextCursor;}while(cursor);}
  for(const task of this.store.listTasks())if(!seen.has(task.feedbackId)){const feedback=db.getFeedback(task.feedbackId,this.users.adminA.id);if(feedback)this.store.syncFeedback(feedback);else if(task.state!=='CLOSED')this.store.transition(task.id,'CLOSED',{reason:'原反馈已不存在，停止自动处理。',handlingMode:'HUMAN'});}
  stopStage=waiting&&this.store.find(waiting.id)?.state!=='WAITING_ACCEPTANCE';
 }finally{db.close();}if(stopStage){this.store.set('pendingPromotion',null);await this.apps.stop('stage');}}
 async ensureEligible(task){
  const db=await appDatabase(this.config);let feedback;try{feedback=db.getFeedback(task.feedbackId,this.users.adminA.id);}finally{db.close();}
  if(feedback)this.store.syncFeedback(feedback);
  if(!agentEligibleFeedback(feedback)||(feedback.agentRevision||0)!==(task.metadata.feedbackRevision||0)){
   if(!feedback)this.store.transition(task.id,'CLOSED',{reason:'原反馈已不存在，停止自动处理。',handlingMode:'HUMAN'});
   this.store.set('pendingPromotion',null);await this.apps.stop('stage');
   const error=Error('反馈处理方式或补充要求已更新，停止旧周期，保留已有代码。');error.code='FEEDBACK_HANDOFF_CHANGED';throw error;
  }
 }
 async taskAgent(task,options){return callAgent(this.config,this.store,{...options,beforeAttempt:()=>this.ensureEligible(task)});}
 async sweep(){const {config,store}=this;store.set('lastSweepAttempt',{state:'RUNNING',at:new Date().toISOString()});try{const missions=['准备提交一条建议，写到一半需要去核对自己的日志详情，再返回继续补充。','新建日志，编写标题、编号列表、缩进和待办，切页及刷新后继续填写。','复制昨天的日志，修改今天的工作内容，保存后在详情核对。','准备一条反馈，检查必填项和失败后继续修改、成功后的状态。'];const index=store.get('sweepIndex',0);const id=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,17),directory=path.join(config.home,'observations',id);const answer=await callAgent(config,store,{role:'user',cwd:config.projectRoot,directory,prompt:userPrompt(config,store.listTasks())+`\nThis sweep's user scenario (not an expected finding): ${missions[index%missions.length]}\nWrite visible conclusions in Chinese. Compare screenshots before claiming a visual bug; editor accessibility snapshots can include hidden Markdown markers.`,browser:{url:config.appUrl,channel:config.browserChannel,evidenceDir:path.join(directory,'browser')},signal:this.abort.signal});store.set('sweepIndex',index+1);store.set('lastSweep',{at:new Date().toISOString(),answer,directory});store.event(null,'sweep_finished',answer.summary,{directory,feedbackSubmitted:answer.feedbackSubmitted});store.set('lastSweepAttempt',{state:'COMPLETED',at:new Date().toISOString(),summary:answer.summary});await this.ingest();}catch(error){store.set('lastSweepAttempt',{state:'FAILED',at:new Date().toISOString(),summary:error.message});store.event(null,'sweep_failed','巡检未完成，未将此次调用记录为有效巡检。',{message:error.message});throw error;}}
 async rejectToHuman(task,reason,detail={}){await this.ensureEligible(task);this.store.transition(task.id,'ESCALATED',{reason,handlingMode:'HUMAN',...detail});await this.updateFeedback(task,'IN_PROGRESS',`自动处理已暂停，需人工判断：${reason}`,{handlingMode:'HUMAN'});}
 async reviewTaskScope(task,request,directory){
  const {config,store}=this;await this.ensureEligible(task);task=store.find(task.id);
  const count=task.metadata.scopeRepairCount||0,requiredFiles=request.requiredFiles||[];
  if(count>=3){await this.rejectToHuman(task,'本周期已完成三次范围复核，仍需要增加范围；保留代码和申请记录，请人工明确需求。',{escalationKind:'scope_limit'});return null;}
  if(!Array.isArray(requiredFiles)||requiredFiles.length>config.maxChangedFiles||requiredFiles.some(file=>!automatableScope(file))){await this.rejectToHuman(task,'范围申请包含受保护文件或超出规模限制，不能自动授予。',{escalationKind:'scope_protected',pendingScopeRequest:request});return null;}
  const contextSha=await integrationHead(config);let root=await checkout(config,`context-${contextSha.slice(0,12)}`,contextSha),candidateContext=false;
  if(task.metadata.worktree&&existsSync(task.metadata.worktree)){
   root=realpathSync(task.metadata.worktree);
   if(!root.startsWith(realpathSync(path.join(config.home,'worktrees'))+path.sep))throw Error('范围复核目录不在本地任务范围内。');
   candidateContext=true;
  }
  const context=planningContext(root,task),saved=new Set(task.metadata.files||[]);
  if(candidateContext){
   for(const line of (await git(config,['status','--porcelain','-uall'],root)).split('\n').filter(Boolean))saved.add(line.slice(3).replace(/^"|"$/g,''));
   if(task.metadata.baseSha)for(const file of (await git(config,['diff','--name-only',task.metadata.baseSha,'HEAD'],root)).split('\n').filter(Boolean))saved.add(file);
  }
  task=store.transition(task.id,'SCOPING',{pendingScopeRequest:request,reason:'正在独立复核必要文件范围及原始验收要求，已有代码和修复轮次保留。'});
  let decision,correction='';
  for(let attempt=1;attempt<=2;attempt++){
   decision=await this.taskAgent(task,{role:'scope',taskId:task.id,cwd:config.projectRoot,directory:path.join(directory,`scope-${task.metadata.repairCycle||0}-${count+1}-${attempt}`),prompt:scopePrompt(task,request,context,[...saved])+correction,source:{root,scope:[]},signal:this.abort.signal});
   await this.ensureEligible(task);
   if(decision.decision!=='APPROVE'){await this.rejectToHuman(task,decision.summary||'范围复核未通过，需要人工明确需求。',{escalationKind:'scope_review',scopeReview:decision});return null;}
   const problems=[];
   if(!validPlan(decision.scopeFiles,decision.acceptance,config))problems.push({problem:'Scope must fit the safe product paths and size limit, with nonempty acceptance criteria.',invalidFiles:Array.isArray(decision.scopeFiles)?decision.scopeFiles.filter(file=>!automatableScope(file)):decision.scopeFiles});
   if(typeof decision.alignment!=='string'||!decision.alignment.trim())problems.push({problem:'A concrete alignment explanation is required.'});
   if(Array.isArray(decision.scopeFiles)&&[...saved].some(file=>!allowedPath(file,decision.scopeFiles)))problems.push({problem:'All saved candidate files must remain covered.',savedFiles:[...saved]});
   if(!problems.length)break;
   if(attempt===2){await this.rejectToHuman(task,'范围计划经过自动修正后仍不符合规则；已保留具体原因，未扩大写入权限。',{escalationKind:'scope_invalid',scopeReview:decision,scopePlanIssues:problems});return null;}
   store.event(task.id,'scope_plan_retry','范围计划格式或文件类型不符合规则，正在自动修正一次；不占用代码修复轮次。',{problems});
   correction='\n<coordinator_plan_validation>'+JSON.stringify({problems,previousScope:decision.scopeFiles,instruction:'Correct the plan within the same safety limits. New UI files under src/components and feedback/markdown helpers under src/lib may use .ts or .tsx; their absence from the existing catalog is normal for a new file. Do not request auth, database or runtime paths. Return ESCALATE only if the original requirement truly needs a protected change.'})+'</coordinator_plan_validation>';
  }
  const entry={at:new Date().toISOString(),cycle:task.metadata.repairCycle||0,oldScope:task.metadata.scopeFiles||[],newScope:decision.scopeFiles,oldAcceptance:task.metadata.acceptance||[],acceptance:decision.acceptance,reason:decision.summary,alignment:decision.alignment,requestedFiles:requiredFiles};
  task=store.transition(task.id,'DEVELOPING',{scopeFiles:decision.scopeFiles,acceptance:decision.acceptance,scopeHistory:[...(task.metadata.scopeHistory||[]),entry],scopeRepairCount:count+1,scopePreflightComplete:true,pendingScopeRequest:null,resumeStage:'DEVELOPING',review:null,qa:null,reason:'范围复核已通过，将在原任务中继续；未重置代码修复次数。'});
  store.event(task.id,'scope_approved',decision.summary,{oldScope:entry.oldScope,newScope:entry.newScope,alignment:entry.alignment});
  await this.updateFeedback(task,'IN_PROGRESS','必要文件范围已通过独立复核，继续原任务；原有代码、评审记录和修复次数保留。');return task;
 }
 async prepareTask(task,directory){
  const {config,store}=this;
  const contextSha=await integrationHead(config),contextRoot=await checkout(config,`context-${contextSha.slice(0,12)}`,contextSha);
  if(task.metadata.pendingScopeRequest){task=await this.reviewTaskScope(task,task.metadata.pendingScopeRequest,directory);if(!task)return null;}
  let scope=task.metadata.scopeFiles,acceptance=task.metadata.acceptance;
  if(!scope||!acceptance){
   store.transition(task.id,'TRIAGING');
   let triage,context=planningContext(contextRoot,task);
   for(let attempt=1;attempt<=2;attempt++){
    triage=await this.taskAgent(task,{role:'triage',taskId:task.id,cwd:config.projectRoot,directory:path.join(directory,`triage-${task.metadata.retryAttempt||0}-${attempt}`),prompt:triagePrompt(task,store.listTasks(),context)+(attempt>1?'\nCoordinator correction: safe product sources can be listed and read with the provided read-only tool. Resolve missing source context before deciding. The unfinished feedback is explicitly assigned to AGENT; historical handoffs and duplicates cannot cancel it. Never write files in triage.':''),source:{root:contextRoot,scope:[]},signal:this.abort.signal});
    await this.ensureEligible(task);
    if(triage.decision==='ESCALATE'&&triage.escalationReason==='CONTEXT'){
     if(attempt===2){await this.rejectToHuman(task,'已自动补查两次源码，仍无法形成可靠的实现范围：'+triage.summary,{escalationKind:'source_context'});return null;}
     context=planningContext(contextRoot,task,{requestedFiles:(triage.contextFiles||[]).slice(0,10)});store.event(task.id,'source_context_retry','筛选缺少源码上下文，已自动补充并重试；没有占用代码修复轮次。',{sourceSha:contextSha,requestedFiles:triage.contextFiles||[]});continue;
    }
    if(!nonBlockingTriageDecision(triage))break;
    store.event(task.id,'triage_policy','当前 Agent 设置优先；历史转人工说明或重复内容不阻止未完成反馈。',{decision:triage.decision,escalationReason:triage.escalationReason,relatedTaskId:store.find(triage.duplicateOf)?.id||null});
    if(validPlan(triage.scopeFiles,triage.acceptance,config)){triage={...triage,decision:'IMPLEMENT'};break;}
    if(attempt===2){await this.rejectToHuman(task,'未完成反馈仍需继续，但筛选未能给出合法的修改范围与验收要求，需要补充需求；没有因重复或历史人工记录停止。');return null;}
   }
   if(triage.decision!=='IMPLEMENT'){await this.rejectToHuman(task,triage.summary||'反馈范围需要人工确认。');return null;}
   scope=triage.scopeFiles;acceptance=triage.acceptance;
  }
  if(!validPlan(scope,acceptance,config))throw Error('反馈范围或验收要求不合法，需人工确认。');
  task=store.transition(task.id,'TRIAGING',{scopeFiles:scope,acceptance});
  if(!task.metadata.scopePreflightComplete){
   const context=planningContext(contextRoot,task);
   if(context.dependenciesOutsideScope.length){task=await this.reviewTaskScope(task,{requiredFiles:context.dependenciesOutsideScope,reason:'页面或表单引用了批准范围外的产品组件，请核对实现原始需求所需的最小文件范围。'},directory);if(!task)return null;scope=task.metadata.scopeFiles;acceptance=task.metadata.acceptance;}
   else task=store.transition(task.id,'TRIAGING',{scopePreflightComplete:true});
  }
  task=store.transition(task.id,'DEVELOPING',{scopeFiles:scope,acceptance});
  const baseSha=await integrationHead(config),used=store.repairRoundsUsed(task.id);
  let previous=null;
  if(task.metadata.worktree&&existsSync(task.metadata.worktree)){
   previous=realpathSync(task.metadata.worktree);
   if(!previous.startsWith(realpathSync(path.join(config.home,'worktrees'))+path.sep))throw Error('保存的任务目录不在本地运行范围内。');
  }
  let stage=task.metadata.resumeStage||'DEVELOPING',round=task.metadata.resumeRound||used+1,worktree=previous;
  if(stage==='DEVELOPING'&&!task.metadata.repairPending)round=Math.min(round,used+1);
  if(!previous||task.metadata.baseSha!==baseSha){
   worktree=await checkout(config,`task-${task.id.slice(0,12)}-${baseSha.slice(0,8)}-${task.metadata.retryAttempt||0}`,baseSha,{branch:true});
   if(previous&&task.metadata.baseSha){
    if(await git(config,['status','--porcelain','-uall'],previous))await commitCandidate(config,task,previous);
    const patch=await git(config,['diff','--no-ext-diff','--unified=3',task.metadata.baseSha,'HEAD'],previous);
    const files=(await git(config,['diff','--name-only',task.metadata.baseSha,'HEAD'],previous)).split('\n').filter(Boolean),changeKinds=await git(config,['diff','--name-status',task.metadata.baseSha,'HEAD'],previous);
    if(files.length>config.maxChangedFiles||Buffer.byteLength(patch)>config.maxDiffBytes||files.some(file=>!allowedPath(file,scope))||/^[DR]/m.test(changeKinds)||/(?:new file|new) mode 120000/.test(patch)||unsafeDiffReason(patch)||/(?:wtk_|fmtopat_|mob_)[a-zA-Z0-9_-]{15,}|sk-[a-zA-Z0-9_-]{20,}/.test(patch))throw Error('保存的候选改动超出范围或存在风险，需人工审查。');
    if(patch){
     const patchFile=path.join(directory,`preserved-${baseSha.slice(0,12)}.patch`);writeFileSync(patchFile,patch+'\n');
     let threeWay=false;
     try{await git(config,['apply','--check',patchFile],worktree);}catch{await git(config,['apply','--3way','--check',patchFile],worktree);threeWay=true;}
     await git(config,['apply',...(threeWay?['--3way']:[]),patchFile],worktree);
     if(threeWay)store.event(task.id,'candidate_three_way','已使用原始版本上下文合并历史候选，保留当前基线的新功能；后续仍检查范围并独立评审。');
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
     if(implementation.scopeRequest?.readOnlyFiles?.length){
      const access=sourceAccess(worktree,[]),requests=implementation.scopeRequest.readOnlyFiles;
      if(requests.length>10||requests.some(file=>{try{return !access.read(file).exists;}catch{return true;}}))return await this.rejectToHuman(task,'只读上下文申请包含不可读取或不存在的文件，已保留具体申请。',{readOnlyContextRequest:implementation.scopeRequest});
      const attempts=(task.metadata.readOnlyContextRetries||0)+1;
      if(attempts>2)return await this.rejectToHuman(task,'两次补充只读上下文后仍未能继续，保留申请与代码，请人工明确剩余问题。',{readOnlyContextRequest:implementation.scopeRequest});
      task=store.transition(task.id,'DEVELOPING',{readOnlyContextRetries:attempts,readOnlyContextFiles:requests,resumeRound:round,repairPending:!!changed});
      store.event(task.id,'read_only_context_ready','只读源码申请已满足，不扩大写入范围，继续原修复轮次。',{files:requests});round--;continue;
     }
     if(implementation.scopeRequest?.requiredFiles?.length){
      task=store.rememberFailure(task.id,'developer',{blockedReason:implementation.scopeRequest.reason,summary:implementation.summary});
      task=await this.reviewTaskScope(task,implementation.scopeRequest,directory);if(!task)return;
      task=store.transition(task.id,'DEVELOPING',{resumeRound:round,repairPending:!!changed});round--;continue;
     }
     if(implementation.blockedReason){task=store.rememberFailure(task.id,'developer',implementation);if(!changed)return await this.rejectToHuman(task,implementation.blockedReason,{repairPending:false,resumeStage:null});store.event(task.id,'developer_validation_pending','开发 Agent 提出了待验证说明；已有改动先走检查与独立评审，未直接转人工。',{note:implementation.blockedReason});}
     let nextCandidate;
     if(changed)nextCandidate=await commitCandidate(config,task,worktree);
     else{
      const sourceSha=await git(config,['rev-parse','HEAD'],worktree);
      const key=createHash('sha256').update(JSON.stringify({sourceSha,scope:task.metadata.scopeFiles,acceptance:task.metadata.acceptance})).digest('hex');
      const previous=task.metadata.noChangeValidation,attempts=previous?.key===key?previous.attempts+1:1;
      if(attempts>2)return await this.rejectToHuman(task,'同一版本连续两次复验仍有具体问题，开发 Agent 未提供修复；已保留检查和评审证据。无新增改动未计为代码修复轮次。',{findings,resumeStage:null,repairPending:false,escalationKind:'no_progress'});
      const files=(await git(config,['diff','--name-only',baseSha,sourceSha],worktree)).split('\n').filter(Boolean);
      nextCandidate={sourceSha,files};
      task=store.transition(task.id,'VERIFYING',{noChangeValidation:{key,attempts,sourceSha,at:new Date().toISOString()}});
      store.event(task.id,'existing_candidate_validation','本次没有新增改动，将验证已有实现；不增加代码修复轮次。',{sourceSha,files,attempts});
     }
     const sameCandidate=task.metadata.sourceSha===nextCandidate.sourceSha;
     task=store.transition(task.id,'VERIFYING',{sourceSha:nextCandidate.sourceSha,files:nextCandidate.files,implementationReused:!changed,resumeStage:'VERIFYING',repairPending:false,...(!sameCandidate?{checks:null,review:null}:{}),verificationAttempts:0,lastCallFailure:null,reason:changed?'代码已保存，正在检查候选版本。':'正在验证已有实现：继续代码检查、独立评审和浏览器复测。'});
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
     const nextRound=store.repairRoundsUsed(task.id)+1;
     task=store.transition(task.id,'VERIFYING',{findings,resumeStage:'DEVELOPING',resumeRound:nextRound,repairPending:false,reason:'代码检查未通过，下一轮只修复实际失败项。'});round=nextRound-1;continue;
    }
    if(checks.tests.total<store.get('baselineChecks').tests.total)throw Error('测试数量低于基线，需人工判断。');
    const completeDiff=await git(config,['diff','--no-ext-diff','--unified=3',baseSha,candidate.sourceSha],worktree);
    const allFiles=(await git(config,['diff','--name-only',baseSha,candidate.sourceSha],worktree)).split('\n').filter(Boolean);
    if(allFiles.length>config.maxChangedFiles||Buffer.byteLength(completeDiff)>config.maxDiffBytes||allFiles.some(file=>!allowedPath(file,task.metadata.scopeFiles)))throw Error('累计变更超出范围或规模限制，已转人工。');
    let review=task.metadata.review;
    if(review?.verdict!=='Approve'||review.sourceSha!==candidate.sourceSha){
     task=store.transition(task.id,'REVIEWING',{resumeStage:'REVIEWING'});
     const context=allFiles.length?relatedContext(worktree,allFiles):JSON.stringify(planningContext(worktree,task));
     review=await this.taskAgent(task,{role:'reviewer',taskId:task.id,cwd:config.projectRoot,directory:path.join(roundDir,'reviewer'),prompt:reviewerPrompt(task,candidate.sourceSha,completeDiff,context,checks),signal:this.abort.signal});
     await this.ensureEligible(task);
     task=store.transition(task.id,'REVIEWING',{review,lastCallFailure:null});
    }
    if(review.sourceSha!==candidate.sourceSha)throw Error('评审版本与检查版本不一致。');
    store.event(task.id,'review',review.summary,{verdict:review.verdict,sourceSha:review.sourceSha});
    if(review.verdict!=='Approve')store.rememberFailure(task.id,'review',review);
    if(review.verdict==='Escalate')return await this.rejectToHuman(task,review.summary,{resumeStage:null,escalationKind:'review'});
    if(review.verdict!=='Approve'){findings={stage:'review',review};const nextRound=store.repairRoundsUsed(task.id)+1;task=store.transition(task.id,'REVIEWING',{findings,reviewHistory:[...(task.metadata.reviewHistory||[]),review].slice(-3),resumeStage:'DEVELOPING',resumeRound:nextRound,repairPending:false,reason:review.summary});round=nextRound-1;continue;}
    if(await git(config,['rev-parse','HEAD'],worktree)!==candidate.sourceSha||await git(config,['status','--porcelain'],worktree)||checks.artifactHash!==buildFingerprint(worktree))throw Error('评审后的代码或构建产物发生变化，禁止部署。');
    task=store.transition(task.id,'STAGING',{resumeStage:'STAGING'});
    await this.ensureEligible(task);
    const release=await this.release(worktree,candidate.sourceSha,checks.artifactHash);await this.apps.start('stage',release);
    const plan=qaPlan(task);
    const verificationKey=createHash('sha256').update(JSON.stringify({sha:candidate.sourceSha,tool:qaToolVersion,acceptance:plan.acceptance,requests:plan.validationRequests,fixtures:plan.permittedFixtures})).digest('hex');
    if(task.metadata.verificationKey!==verificationKey){
     task=store.transition(task.id,'STAGING',{verificationKey,verificationAttempts:0,qaProgress:null,verificationHistory:[...(task.metadata.verificationHistory||[]),...(task.metadata.verificationKey?[{key:task.metadata.verificationKey,attempts:task.metadata.verificationAttempts||0,at:new Date().toISOString()}]:[])]});
     store.event(task.id,'qa_capabilities_ready','已按当前验收计划准备验证能力，工具版本或验收要求变化后只重新计算验证额度，原开发轮次与历史证据保留。',{toolVersion:qaToolVersion,fixtures:plan.permittedFixtures,imagePasteAllowed:plan.imagePasteAllowed});
    }
    const qa=await this.taskAgent(task,{role:'qa',taskId:task.id,cwd:config.projectRoot,directory:path.join(roundDir,'qa'),prompt:qaPrompt(task,config.stageUrl),browser:{url:config.stageUrl,channel:config.browserChannel,evidenceDir:path.join(roundDir,'qa/browser'),testFixtures:true,fixtureModes:plan.permittedFixtures,maySubmitFeedback:plan.maySubmitFeedback,imagePasteAllowed:plan.imagePasteAllowed},signal:this.abort.signal});
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
      const limit=config.maxVerificationAttempts||5,progress={sourceSha:candidate.sourceSha,toolVersion:qaToolVersion,checks:[...(task.metadata.qaProgress?.checks||[]),...(qa.checks||[]).filter(item=>item.passed===true).map(item=>({...item,evidenceDir}))]};
      progress.checks=[...new Map(progress.checks.map(item=>[item.name,item])).values()];
      if(attempts>=limit)return await this.rejectToHuman(task,`浏览器验证已进行 ${attempts} 次，仍有未取得的证据；保留已验证项目、代码与评审，只需处理剩余验证问题：${qa.summary}`,{findings,verificationAttempts:attempts,qaProgress:progress,resumeStage:'STAGING',escalationKind:'verification_tooling'});
      store.transition(task.id,'QUEUED',{findings,verificationAttempts:attempts,qaProgress:progress,resumeStage:'STAGING',resumeRound:round,repairPending:false,reason:`已保留通过的验证项目，将针对剩余证据继续浏览器验证（${attempts}/${limit}），不占代码修复轮次。`});store.set('backoffUntil',new Date(Date.now()+30000).toISOString());return;
     }
     const nextRound=store.repairRoundsUsed(task.id)+1;
     task=store.transition(task.id,'STAGING',{findings,resumeStage:'DEVELOPING',resumeRound:nextRound,repairPending:false,reason:qa.summary});await this.apps.stop('stage');round=nextRound-1;continue;
    }
    const acceptedDraft={kind:'LOCAL_PR_DRAFT',remotePrCreated:false,baseSha,sourceSha:candidate.sourceSha,title:task.title,feedbackId:task.feedbackId,files:allFiles,checks,review,qa};json(path.join(directory,'local-pr.json'),acceptedDraft);writeFileSync(path.join(directory,'candidate.patch'),completeDiff);
    store.transition(task.id,'WAITING_ACCEPTANCE',{sourceSha:candidate.sourceSha,release,artifactHash:checks.artifactHash,stageUrl:config.stageUrl,checks,review,qa,resumeStage:null,repairPending:false,lastCallFailure:null,reason:'本地测试版已就绪，等待两名不同账号的真人验收。'});
    await this.updateFeedback(task,'IN_PROGRESS','候选版已通过检查、独立评审和浏览器复测，等待两名真人验收。');store.event(task.id,'notification','本地测试版就绪，请两名真人验收。',{url:config.appUrl+'/console/admin/rsi',stageUrl:config.stageUrl});return;
   }
   await this.rejectToHuman(task,`本周期实际代码修复已完成 ${store.repairRoundsUsed(task.id)} 轮，仍有未解决的问题，保留全部证据并转人工；无改动和调用故障不计为代码修复。`,{findings,resumeStage:null,repairPending:false,escalationKind:'repair_limit'});
  }catch(error){if(error.code==='FEEDBACK_HANDOFF_CHANGED')return;try{await this.ensureEligible(task);}catch(handoff){if(handoff.code==='FEEDBACK_HANDOFF_CHANGED')return;throw handoff;}task=store.find(task.id);const failure=taskFailureAction(task,error,{aborted:this.abort.signal.aborted,maxInfrastructureFailures:callFailureLimit(config,task),infrastructureFailures:store.callFailures(task.id)});if(failure.state==='QUEUED'){store.transition(task.id,'QUEUED',failure.metadata);await this.updateFeedback(task,'IN_PROGRESS',failure.metadata.reason).catch(()=>{});}else await this.rejectToHuman(task,failure.metadata.reason,failure.metadata).catch(handoff=>{if(handoff.code!=='FEEDBACK_HANDOFF_CHANGED')store.transition(task.id,'ESCALATED',failure.metadata);});throw error;}
 }
 async release(source,sha,fingerprint){const target=await checkout(this.config,`release-${sha.slice(0,12)}-${fingerprint.slice(0,16)}`,sha);if(!existsSync(path.join(target,'.next'))){const root=path.join(source,'.next');cpSync(root,path.join(target,'.next'),{recursive:true,filter:file=>!path.relative(root,file).split(path.sep).includes('cache')});}if(buildFingerprint(target)!==fingerprint)throw Error('部署产物与检查产物不一致。');return target;}
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
  const updating=this.store.get('localUpdate');if(localUpdateActive(updating)&&updating.taskId===task.id&&updating.sourceSha===sha)return;
  recordLocalUpdate(this.store,task,'QUEUED','两名验收人已通过，正在准备更新本地应用。','queued');
  this.store.set('pendingPromotion',{taskId:task.id,sourceSha:sha});this.store.event(task.id,'promotion_queued','两名验收人已通过，等待服务空闲后更新本地版本。');
 }
 async promote(task){
  const sha=task.metadata.sourceSha;
  if(task.state!=='WAITING_ACCEPTANCE')return;
  recordLocalUpdate(this.store,task,'RUNNING','正在核对验收结果、候选版本和构建产物。','validating');
  try{
   await this.ensureEligible(task);
   const approvals=this.store.approvals(task.id).filter(item=>item.sourceSha===sha&&item.decision==='approve');
   if(new Set(approvals.map(item=>item.userId)).size<2)throw Error('尚未得到两名不同验收人批准。');
   if(await integrationHead(this.config)!==task.metadata.baseSha||buildFingerprint(task.metadata.release)!==task.metadata.artifactHash)throw Error('集成基线或构建产物变化，禁止自动合并。');
  }catch(error){recordLocalUpdate(this.store,task,error.code==='FEEDBACK_HANDOFF_CHANGED'?'CANCELLED':'FAILED',`本地更新未开始：${error.message}`,'validation_failed');if(error.code==='FEEDBACK_HANDOFF_CHANGED')return;throw error;}
  const previous=this.store.get('currentRelease');let refUpdated=false;
  try{
   recordLocalUpdate(this.store,task,'RUNNING','正在将已验收的测试版切换为本地应用，切换期间页面可能短暂重新连接。','switching');
   await this.apps.start('baseline',task.metadata.release);
   await this.ensureEligible(task);
   recordLocalUpdate(this.store,task,'RUNNING','本地应用已启动，正在保存版本并确认更新结果。','saving');
   await git(this.config,['update-ref',this.config.integrationRef,sha,task.metadata.baseSha]);refUpdated=true;
   this.store.set('currentRelease',{sourceSha:sha,root:task.metadata.release});this.store.set('baselineChecks',task.metadata.checks);this.store.transition(task.id,'ACCEPTED',{reason:'两名真人已验收，通过本地集成；未发布生产环境。'});await this.updateFeedback(task,'COMPLETED','两名真人验收通过，已更新本地集成版本。');
   recordLocalUpdate(this.store,task,'SUCCEEDED','本地更新完成，新版本已生效。自动运行开关保持原设置。','complete');
  }catch(error){
   recordLocalUpdate(this.store,task,'RUNNING','本地更新未完成，正在尝试恢复上一版本。','restoring');
   try{
    if(refUpdated)await git(this.config,['update-ref',this.config.integrationRef,task.metadata.baseSha,sha]);
    if(previous){try{await this.apps.start('baseline',previous.root);this.store.set('currentRelease',previous);}catch{this.store.set('appReady',false);}}
   }finally{recordLocalUpdate(this.store,task,error.code==='FEEDBACK_HANDOFF_CHANGED'?'CANCELLED':'FAILED',`本地更新未完成，已尝试恢复上一版本：${error.message}`,'failed');}
   if(error.code==='FEEDBACK_HANDOFF_CHANGED')return;
   await this.rejectToHuman(task,`本地集成未完成，已尝试恢复上一版：${error.message}`);throw error;
  }
 }
}
