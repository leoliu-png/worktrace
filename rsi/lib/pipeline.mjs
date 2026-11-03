import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,cpSync,readdirSync,realpathSync} from 'node:fs';
import {callAgent} from './codex.mjs';
import {userPrompt,developerPrompt,reviewerPrompt} from './prompts.mjs';
import {git,integrationHead,checkout,commitCandidate,relatedContext,allowedPath,unsafeDiffReason} from './git.mjs';
import {appDatabase} from './local-app.mjs';
import {checkCandidate,buildFingerprint,checkFailureLogs} from './checks.mjs';
import {taskFailureAction,callFailureLimit} from './retry.mjs';
import {canContinueTask} from './task-policy.mjs';
import {qaPlan,missingQaCapabilities,qaVerificationKey} from './task-memory.mjs';
import {agentEligibleFeedback,unfinishedFeedbackStatuses} from './feedback-policy.mjs';
import {automatableScope,validScopePlan as validPlan,planningContext,missingSavedScope} from './scope-policy.mjs';
import {recordLocalUpdate,localUpdateActive} from './local-update.mjs';
import {qaToolVersion} from './qa-capabilities.mjs';
import {sourceAccess} from './source-access.mjs';
import {recordSweepResult} from './sweep-result.mjs';
import {savedWorkerSession} from './worker-session.mjs';
import {syncAcceptedWorkspace} from './workspace-sync.mjs';
import {requestCleanup,restoreArchivedCandidate} from './cleanup.mjs';
import {browserQaDisposition,recoverableToolingResult} from './qa-disposition.mjs';
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
 async ingest(){const cleanupStates=new Map(this.store.listTasks().map(task=>[task.id,task.state]));const db=await appDatabase(this.config);let stopStage=false;const waiting=this.store.listTasks().find(task=>task.state==='WAITING_ACCEPTANCE');try{
  const seen=new Set();for(const status of unfinishedFeedbackStatuses){let cursor=null;do{const result=db.listFeedback(this.users.adminA.id,{all:true,status,limit:50,cursor});for(const feedback of result.items){seen.add(feedback.id);this.store.syncFeedback(feedback);}cursor=result.nextCursor;}while(cursor);}
  for(const task of this.store.listTasks())if(!seen.has(task.feedbackId)){const feedback=db.getFeedback(task.feedbackId,this.users.adminA.id);if(feedback)this.store.syncFeedback(feedback);else if(task.state!=='CLOSED')this.store.transition(task.id,'CLOSED',{reason:'原反馈已不存在，停止自动处理。',handlingMode:'HUMAN'});}
  stopStage=waiting&&this.store.find(waiting.id)?.state!=='WAITING_ACCEPTANCE';
 }finally{db.close();}if(stopStage){this.store.set('pendingPromotion',null);await this.apps.stop('stage');}if(this.store.listTasks().some(task=>['CLOSED','ESCALATED','HELD','ACCEPTED'].includes(task.state)&&cleanupStates.get(task.id)!==task.state))requestCleanup(this.store,'反馈状态发生变化');}
 async ensureEligible(task){
  if(this.abort.signal.aborted)throw Error('任务已中断。');
  const db=await appDatabase(this.config);let feedback;try{feedback=db.getFeedback(task.feedbackId,this.users.adminA.id);}finally{db.close();}
  if(feedback)this.store.syncFeedback(feedback);
  if(!agentEligibleFeedback(feedback)||(feedback.agentRevision||0)!==(task.metadata.feedbackRevision||0)){
   if(!feedback)this.store.transition(task.id,'CLOSED',{reason:'原反馈已不存在，停止自动处理。',handlingMode:'HUMAN'});
   this.store.set('pendingPromotion',null);await this.apps.stop('stage');
   const error=Error('反馈处理方式或补充要求已更新，停止旧周期，保留已有代码。');error.code='FEEDBACK_HANDOFF_CHANGED';throw error;
  }
 }
 async taskAgent(task,options){
  if(options.role==='developer'&&options.source){const db=await appDatabase(this.config);try{const feedback=db.getFeedback(task.feedbackId,this.users.adminA.id);const images=(feedback?.attachments||[]).slice(0,5).map(image=>db.getFeedbackAttachment(feedback.id,image.id,this.users.adminA.id)).filter(Boolean);options={...options,source:{...options.source,feedbackImages:images,uploadRoot:path.join(this.config.home,'uploads')}};}finally{db.close();}}
  return callAgent(this.config,this.store,{...options,beforeAttempt:()=>this.ensureEligible(task)});
 }
 async sweep(){const {config,store}=this;store.set('lastSweepAttempt',{state:'RUNNING',at:new Date().toISOString()});try{const missions=['准备提交一条建议，写到一半需要去核对自己的日志详情，再返回继续补充。','新建日志，编写标题、编号列表、缩进和待办，切页及刷新后继续填写。','复制昨天的日志，修改今天的工作内容，保存后在详情核对。','准备一条反馈，检查必填项和失败后继续修改；只有发现可提交的新问题时，再检查提交成功后的状态。'];const index=store.get('sweepIndex',0);const id=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,17),directory=path.join(config.home,'observations',id);const answer=await callAgent(config,store,{role:'user',cwd:config.projectRoot,directory,prompt:userPrompt(config,store.listTasks())+`\nThis sweep's user scenario (not an expected finding): ${missions[index%missions.length]}\nWrite visible conclusions in Chinese. Compare screenshots before claiming a visual bug; editor accessibility snapshots can include hidden Markdown markers.`,browser:{url:config.appUrl,channel:config.browserChannel,evidenceDir:path.join(directory,'browser')},signal:this.abort.signal});recordSweepResult(store,answer,{directory,index});await this.ingest();}catch(error){store.set('lastSweepAttempt',{state:'FAILED',at:new Date().toISOString(),summary:error.message});store.event(null,'sweep_failed','巡检未完成，未将此次调用记录为有效巡检。',{message:error.message});throw error;}}
 async rejectToHuman(task,reason,detail={}){await this.ensureEligible(task);requestCleanup(this.store,'任务转人工或结束');this.store.transition(task.id,'ESCALATED',{reason,handlingMode:'HUMAN',...detail});await this.updateFeedback(task,'IN_PROGRESS',`自动处理已暂停，需人工判断：${reason}`,{handlingMode:'HUMAN'});}
 async holdTask(task,reason,holdReason='diagnosis'){
  requestCleanup(this.store,'任务已暂停，清理无用测试副本');
  this.store.transition(task.id,'HELD',{reason,holdReason});this.store.event(task.id,'workflow_held',reason,{holdReason});
 }
 async reviewTaskScope(task,request){
  await this.ensureEligible(task);const required=request.requiredFiles||[];
  const scope=[...new Set([...(task.metadata.scopeFiles||[]),...required])];
  if(!required.length||required.some(file=>!automatableScope(file))||scope.length>this.config.maxChangedFiles){await this.holdTask(task,'需要受保护文件或范围过大，已保留代码与具体申请。','scope');return null;}
  const count=task.metadata.scopeRepairCount||0;
  if(count>=2){await this.holdTask(task,'两次范围补充后仍未定位完整修改范围，暂停继续调用。','scope');return null;}
  this.store.event(task.id,'scope_approved','已补充安全产品文件范围，独立评审会核对需求相关性。',{required});
  return this.store.transition(task.id,'DEVELOPING',{scopeFiles:scope,scopeRepairCount:count+1,pendingScopeRequest:null,resumeStage:'DEVELOPING'});
 }
 async prepareTask(task,directory){
  const {config,store}=this,contextSha=await integrationHead(config),contextRoot=await checkout(config,`context-${contextSha.slice(0,12)}`,contextSha);
  const restored=await restoreArchivedCandidate(config,task);if(restored)task=store.transition(task.id,task.state,restored);
  let scope=task.metadata.scopeFiles,acceptance=task.metadata.acceptance;
  if(!Array.isArray(scope)||!scope.length){scope=planningContext(contextRoot,task).files.map(item=>item.file).filter(automatableScope).filter(file=>!file.includes('.test.')).slice(0,6);}
  if(!Array.isArray(acceptance)||!acceptance.length)acceptance=[task.description||task.title];
  task=store.transition(task.id,task.state,{workflowVersion:3,scopeFiles:scope,acceptance});
  if(!validPlan(scope,acceptance,config))throw Error('修改范围不合法。');
  if(task.metadata.worktree&&task.metadata.baseSha&&existsSync(task.metadata.worktree)){
   const saved=(await git(config,['diff','--name-only',task.metadata.baseSha,'HEAD'],task.metadata.worktree)).split('\n').filter(Boolean);
   const missing=missingSavedScope(saved,scope);
   if(missing.length){task=await this.reviewTaskScope(task,{requiredFiles:missing});if(!task)return null;scope=task.metadata.scopeFiles;}
  }
  if(task.metadata.pendingScopeRequest){task=await this.reviewTaskScope(task,task.metadata.pendingScopeRequest);if(!task)return null;scope=task.metadata.scopeFiles;}
  const baseSha=await integrationHead(config),used=store.repairRoundsUsed(task.id);
  let previous=null;
  if(task.metadata.worktree&&existsSync(task.metadata.worktree)){
   previous=realpathSync(task.metadata.worktree);
   if(!previous.startsWith(realpathSync(path.join(config.home,'worktrees'))+path.sep))throw Error('保存的任务目录不在本地运行范围内。');
  }
  let stage=['DEVELOPING','VERIFYING','REVIEWING','STAGING'].includes(task.metadata.resumeStage)?task.metadata.resumeStage:'DEVELOPING',round=task.metadata.resumeRound||used+1,worktree=previous;
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
  task=store.transition(task.id,stage,{baseSha,worktree,resumeStage:stage,resumeRound:round,reason:`继续${{DEVELOPING:'代码修复',VERIFYING:'代码检查',REVIEWING:'独立评审',STAGING:'部署本地测试版'}[stage]||'处理反馈'}，已有成果和历史记录保留。`});
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
     const previewUrl=`http://127.0.0.1:${config.previewPort||config.stagePort+10}`;
     await this.apps.start('preview',worktree,{dev:true});
     let implementation;
     try{implementation=await this.taskAgent(task,{role:'developer',taskId:task.id,repairRound:round,cwd:worktree,directory:path.join(roundDir,'developer'),prompt:developerPrompt(task,findings,{context:savedWorkerSession(task,worktree)?null:planningContext(worktree,task),previewUrl,continuing:!!savedWorkerSession(task,worktree)}),source:{root:worktree,scope:[...task.metadata.scopeFiles],allowScopeExpansion:true,maxChangedFiles:config.maxChangedFiles},browser:{url:previewUrl,channel:config.browserChannel,testFixtures:true,fixtureModes:[],maySubmitFeedback:false,imagePasteAllowed:/图片|image|图像/i.test(task.description+' '+(task.metadata.agentInstructions||''))},signal:this.abort.signal});}
     finally{await this.apps.stop('preview');}
     const scopeFiles=[...new Set([...(task.metadata.scopeFiles||[]),...(implementation.scopeFiles||[])])];
     const acceptance=implementation.acceptance?.length?implementation.acceptance:task.metadata.acceptance;
     if(!validPlan(scopeFiles,acceptance,config)||acceptance.length>5){await this.holdTask(task,'做事 Agent 返回的修改范围或验收要求无效，保留会话等待调整。','scope');return;}
     task=store.transition(task.id,'DEVELOPING',{scopeFiles,acceptance,workerVerification:implementation._rsiVerification||{status:'unverified',summary:'待真人验证当前需求。',checks:[]},diagnosis:{rootCause:implementation.rootCause||task.metadata.diagnosis?.rootCause||'',summary:implementation.summary,evidence:implementation.verification?.checks?.map(item=>item.evidence)||[]}});
     if(implementation.verification?.status==='product_failure'){findings={stage:'worker_verification',summary:implementation.verification.summary,checks:implementation.verification.checks};task=store.transition(task.id,'DEVELOPING',{findings});}

     await this.ensureEligible(task);
     const changed=await git(config,['status','--porcelain','-uall'],worktree);
     if(implementation.scopeRequest?.readOnlyFiles?.length){
      const access=sourceAccess(worktree,[]),requests=implementation.scopeRequest.readOnlyFiles;
      if(requests.length>10||requests.some(file=>{try{return !access.read(file).exists;}catch{return true;}}))return await this.rejectToHuman(task,'只读上下文申请包含不可读取或不存在的文件，已保留具体申请。',{readOnlyContextRequest:implementation.scopeRequest});
      const attempts=(task.metadata.readOnlyContextRetries||0)+1;
      if(attempts>1)return await this.rejectToHuman(task,'两次补充只读上下文后仍未能继续，保留申请与代码，请人工明确剩余问题。',{readOnlyContextRequest:implementation.scopeRequest});
      task=store.transition(task.id,'DEVELOPING',{readOnlyContextRetries:attempts,readOnlyContextFiles:requests,resumeRound:round,repairPending:!!changed});
      store.event(task.id,'read_only_context_ready','只读源码申请已满足，不扩大写入范围，继续原修复轮次。',{files:requests});round--;continue;
     }
     if(implementation.scopeRequest?.requiredFiles?.length){
      task=store.rememberFailure(task.id,'developer',{blockedReason:implementation.scopeRequest.reason,summary:implementation.summary});
      task=await this.reviewTaskScope(task,implementation.scopeRequest,directory);if(!task)return;
      task=store.transition(task.id,'DEVELOPING',{resumeRound:round,repairPending:!!changed});round--;continue;
     }
     if(implementation.verification?.status==='product_failure'){if(changed)await commitCandidate(config,task,worktree);const nextRound=store.repairRoundsUsed(task.id)+1;task=store.transition(task.id,'DEVELOPING',{resumeStage:'DEVELOPING',resumeRound:nextRound,repairPending:false,reason:implementation.verification.summary});round=nextRound-1;continue;}
     if(implementation.blockedReason){task=store.rememberFailure(task.id,'developer',implementation);if(!changed){if(/budget|预算|工具|tool/i.test(implementation.blockedReason)){await this.holdTask(task,implementation.blockedReason,'tooling');return;}return await this.rejectToHuman(task,implementation.blockedReason,{repairPending:false,resumeStage:null});}store.event(task.id,'developer_validation_pending','开发 Agent 提出了待验证说明；已有改动先走检查与独立评审，未直接转人工。',{note:implementation.blockedReason});}
     const changedFiles=changed.split('\n').filter(Boolean).map(line=>line.slice(3).replace(/^"|"$/g,''));
     const testsOnly=changedFiles.length&&changedFiles.every(file=>/\.test\.[tj]sx?$/.test(file));
     if(testsOnly){const n=(task.metadata.testsOnlyAttempts||0)+1;task=store.transition(task.id,'DEVELOPING',{testsOnlyAttempts:n});if(n>1){await this.holdTask(task,'连续两次仅增加测试，原始产品问题仍未得到实现修复。','no_progress');return;}findings={summary:'仅新增测试不能修复已复现的产品问题。请根据诊断中的 DOM/渲染证据修改实现；不要继续扩大测试矩阵。'};round--;continue;}
     if(!changed&&(!task.metadata.sourceSha||task.metadata.sourceSha===baseSha)){const n=(task.metadata.noImplementationAttempts||0)+1;task=store.transition(task.id,'DEVELOPING',{noImplementationAttempts:n});if(n>1){await this.holdTask(task,'已复现问题，但连续两次未产生实现改动，保留根因证据等待进一步定位。','no_progress');return;}findings={summary:'诊断已复现原问题，但尚无实现修复。请修改根因，不能用已有测试通过代替修复。',rootCause:task.metadata.diagnosis?.rootCause};round--;continue;}
     let nextCandidate;
     if(changed)nextCandidate=await commitCandidate(config,task,worktree);
     else{
      const sourceSha=await git(config,['rev-parse','HEAD'],worktree);
      const key=createHash('sha256').update(JSON.stringify({sourceSha,scope:task.metadata.scopeFiles,acceptance:task.metadata.acceptance})).digest('hex');
      const previous=task.metadata.noChangeValidation,attempts=previous?.key===key?previous.attempts+1:1;
      if(attempts>1)return await this.rejectToHuman(task,'同一版本连续两次复验仍有具体问题，开发 Agent 未提供修复；已保留检查和评审证据。无新增改动未计为代码修复轮次。',{findings,resumeStage:null,repairPending:false,escalationKind:'no_progress'});
      const files=(await git(config,['diff','--name-only',baseSha,sourceSha],worktree)).split('\n').filter(Boolean);
      nextCandidate={sourceSha,files};
      task=store.transition(task.id,'VERIFYING',{noChangeValidation:{key,attempts,sourceSha,at:new Date().toISOString()}});
      store.event(task.id,'existing_candidate_validation','本次没有新增改动，将验证已有实现；不增加代码修复轮次。',{sourceSha,files,attempts});
     }
     const sameCandidate=task.metadata.sourceSha===nextCandidate.sourceSha;
     task=store.transition(task.id,'VERIFYING',{sourceSha:nextCandidate.sourceSha,files:nextCandidate.files,implementationReused:!changed,resumeStage:'VERIFYING',repairPending:false,...(!sameCandidate?{checks:null,review:null}:{}),verificationAttempts:0,lastCallFailure:null,reason:changed?'代码已保存，正在检查候选版本。':'正在验证已有实现：继续代码检查、独立评审和需求验证。'});
    }
    const candidate={sourceSha:task.metadata.sourceSha,files:task.metadata.files,diff:await git(config,['diff','--no-ext-diff','--unified=3',baseSha,task.metadata.sourceSha],worktree)};
    if(await git(config,['rev-parse','HEAD'],worktree)!==candidate.sourceSha||await git(config,['status','--porcelain'],worktree))throw Error('保存的候选代码版本已改变，禁止继续检查或部署。');
    const completeDiff=candidate.diff;
    const allFiles=(await git(config,['diff','--name-only',baseSha,candidate.sourceSha],worktree)).split('\n').filter(Boolean);
    const changeKinds=await git(config,['diff','--name-status',baseSha,candidate.sourceSha],worktree);
    if(allFiles.length>config.maxChangedFiles||Buffer.byteLength(completeDiff)>config.maxDiffBytes||/(?:^|\n)[DR]/.test(changeKinds)||/(?:new file|new) mode 120000/.test(completeDiff)||unsafeDiffReason(completeDiff)||/(?:wtk_|fmtopat_|mob_)[a-zA-Z0-9_-]{15,}|sk-[a-zA-Z0-9_-]{20,}/.test(completeDiff))throw Error('累计变更超出规模限制或存在安全风险，已转人工。');
    const scopeMissing=missingSavedScope(allFiles,task.metadata.scopeFiles);
    if(scopeMissing.length){
     store.event(task.id,'candidate_scope_preflight','候选文件需先完成独立范围复核，再运行代码检查。',{files:scopeMissing});
     task=await this.reviewTaskScope(task,{requiredFiles:scopeMissing,reason:'候选版本的累计改动包含当前范围外的文件，请按原始反馈核对全部改动。'},directory);
     if(!task)return;
     if(allFiles.some(file=>!allowedPath(file,task.metadata.scopeFiles)))throw Error('独立范围复核未覆盖候选全部文件。');
     task=store.transition(task.id,'VERIFYING',{resumeStage:'VERIFYING',reason:'候选范围已通过独立复核，继续代码检查。'});
    }
    const draft={kind:'LOCAL_PR_DRAFT',remotePrCreated:false,state:'VERIFYING',feedbackId:task.feedbackId,title:task.title,baseSha,sourceSha:candidate.sourceSha,files:candidate.files};json(path.join(roundDir,'local-pr.json'),draft);json(path.join(directory,'local-pr.json'),draft);writeFileSync(path.join(roundDir,'candidate.patch'),candidate.diff);writeFileSync(path.join(directory,'candidate.patch'),await git(config,['diff','--no-ext-diff','--unified=3',baseSha,candidate.sourceSha],worktree));
    let checks=task.metadata.checks;
    let reusable=checks?.passed&&checks.sourceSha===candidate.sourceSha&&existsSync(path.join(worktree,'.next/BUILD_ID'));
    if(reusable)try{reusable=checks.artifactHash===buildFingerprint(worktree);}catch{reusable=false;}
    if(!reusable){
     task=store.transition(task.id,'VERIFYING',{resumeStage:'VERIFYING'});
     checks=await checkCandidate(config,worktree,path.join(roundDir,'checks'),{signal:this.abort.signal});store.event(task.id,'checks',checks.passed?'代码规范、类型检查和构建通过':'检查未通过',{sourceSha:candidate.sourceSha,checks});
     await this.ensureEligible(task);
     task=store.transition(task.id,'VERIFYING',{checks});
    }
    if(!checks.passed){
     findings={stage:'checks',checks,logs:checkFailureLogs(checks,path.join(roundDir,'checks'))};
     store.rememberFailure(task.id,'checks',{...checks,summary:'代码检查未通过，具体断言及错误日志已保存。',logs:findings.logs});
     const nextRound=store.repairRoundsUsed(task.id)+1;
     task=store.transition(task.id,'VERIFYING',{findings,resumeStage:'DEVELOPING',resumeRound:nextRound,repairPending:false,reason:'代码检查未通过，下一轮只修复实际失败项。'});round=nextRound-1;continue;
    }
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
    const verification=task.metadata.workerVerification||{status:'unverified',summary:'旧流程候选缺少做事 Agent 的按需求验证记录，请真人检查原始要求。',checks:[]};
    const manualRequests=(review.validationRequests||[]).map(name=>({name,passed:false,evidence:'独立评审提出的真人验收重点。'}));
    const qa={passed:verification.status==='passed'&&!manualRequests.length,failureKind:verification.status==='product_failure'?'product':verification.status==='passed'&&!manualRequests.length?'none':'tooling',summary:verification.summary,checks:[...(verification.checks||[]),...manualRequests],observations:[],_rsiEvidenceDir:verification.evidenceDir};
    const evidenceDir=verification.evidenceDir;
    const actualEvidence=evidenceDir&&existsSync(evidenceDir)?readdirSync(evidenceDir).filter(name=>name.endsWith('.png')):[];
    const qaDisposition=browserQaDisposition(qa,actualEvidence);
    if(qaDisposition.status==='product_failure'){findings={stage:'worker_verification',qa};const nextRound=store.repairRoundsUsed(task.id)+1;task=store.transition(task.id,'STAGING',{findings,resumeStage:'DEVELOPING',resumeRound:nextRound,repairPending:false,reason:qa.summary});await this.apps.stop('stage');round=nextRound-1;continue;}
    store.event(task.id,'worker_verification',qa.summary,{sourceSha:candidate.sourceSha,status:qaDisposition.status});
    if(await git(config,['rev-parse','HEAD'],worktree)!==candidate.sourceSha||await git(config,['status','--porcelain'],worktree)||checks.artifactHash!==buildFingerprint(worktree)||checks.artifactHash!==buildFingerprint(release))throw Error('验收前代码或测试产物已变化，禁止继续。');
    await this.ensureEligible(task);
    const warning=qaDisposition.status==='unverified'?`部分需求待真人验证：${qaDisposition.summary}`:'';
    if(warning)store.event(task.id,'qa_unverified',warning,{sourceSha:candidate.sourceSha,unverifiedChecks:qaDisposition.unverifiedChecks,blockedCapabilities:qaDisposition.blockedCapabilities});
    const acceptedDraft={kind:'LOCAL_PR_DRAFT',remotePrCreated:false,baseSha,sourceSha:candidate.sourceSha,title:task.title,feedbackId:task.feedbackId,files:allFiles,checks,review,qa,qaDisposition};json(path.join(directory,'local-pr.json'),acceptedDraft);writeFileSync(path.join(directory,'candidate.patch'),completeDiff);
    store.transition(task.id,'WAITING_ACCEPTANCE',{sourceSha:candidate.sourceSha,release,artifactHash:checks.artifactHash,stageUrl:config.stageUrl,checks,review,qa,qaDisposition,resumeStage:null,repairPending:false,lastCallFailure:null,reason:warning||'本地测试版已就绪，等待两名不同账号的真人验收。'});
    await this.updateFeedback(task,'IN_PROGRESS',warning?`候选版通过代码检查和独立评审；${warning} 两名真人验收后才能更新。`:'候选版已通过检查、独立评审和需求验证，等待两名真人验收。');store.event(task.id,'notification',warning?'本地测试版就绪；浏览器部分未验证，请两名真人重点验收。':'本地测试版就绪，请两名真人验收。',{url:config.appUrl+'/console/admin/rsi',stageUrl:config.stageUrl});return;
   }
   await this.rejectToHuman(task,`本周期实际代码修复已完成 ${store.repairRoundsUsed(task.id)} 轮，仍有未解决的问题，保留全部证据并转人工；无改动和调用故障不计为代码修复。`,{findings,resumeStage:null,repairPending:false,escalationKind:'repair_limit'});
  }catch(error){await this.apps.stop?.('preview')?.catch(()=>{});if(['TASK_BUDGET','TOOL_PREFLIGHT'].includes(error.code)){await this.holdTask(store.find(task.id),error.message,error.code==='TASK_BUDGET'?'budget':'tooling');return;}const interruption=store.get('taskInterruption');if(interruption?.taskId===task.id){const current=store.find(task.id);if(current&&!['ACCEPTED','WAITING_ACCEPTANCE','CLOSED'].includes(current.state)){store.transition(task.id,'HELD',{reason:'管理员已中断任务，已有代码和运行记录已保留；可手动恢复。',interruptedAt:new Date().toISOString()});store.event(task.id,'task_interrupted','任务已中断，已有代码和运行记录已保留。',{actor:interruption.actor});}return;}if(error.code==='FEEDBACK_HANDOFF_CHANGED')return;try{await this.ensureEligible(task);}catch(handoff){if(handoff.code==='FEEDBACK_HANDOFF_CHANGED')return;throw handoff;}task=store.find(task.id);const failure=taskFailureAction(task,error,{aborted:this.abort.signal.aborted,maxInfrastructureFailures:callFailureLimit(config,task),infrastructureFailures:store.callFailures(task.id)});if(failure.state==='QUEUED'){store.transition(task.id,'QUEUED',failure.metadata);await this.updateFeedback(task,'IN_PROGRESS',failure.metadata.reason).catch(()=>{});}else await this.rejectToHuman(task,failure.metadata.reason,failure.metadata).catch(handoff=>{if(handoff.code!=='FEEDBACK_HANDOFF_CHANGED')store.transition(task.id,'ESCALATED',failure.metadata);});throw error;}
 }
 async release(source,sha,fingerprint){const target=await checkout(this.config,`release-${sha.slice(0,12)}-${fingerprint.slice(0,16)}`,sha);if(!existsSync(path.join(target,'.next'))){const root=path.join(source,'.next');cpSync(root,path.join(target,'.next'),{recursive:true,filter:file=>!path.relative(root,file).split(path.sep).includes('cache')});}if(buildFingerprint(target)!==fingerprint)throw Error('部署产物与检查产物不一致。');return target;}
 async handoffTooling(task,actor){
  if(this.store.active()||this.store.get('processRequested')||this.store.get('currentWork')||!this.store.get('appReady'))throw Error('已有任务正在执行或等待验收，请稍后再操作。');
  const runs=this.store.db.prepare("SELECT role,state,metadata FROM runs WHERE task_id=? AND role='qa' ORDER BY started_at DESC").all(task.id).map(row=>({...row,metadata:JSON.parse(row.metadata)}));
  const disposition=recoverableToolingResult(task,runs),m=task.metadata,checks=m.checks;
  const root=realpathSync(path.join(this.config.home,'worktrees')),worktree=realpathSync(m.worktree);
  if(!worktree.startsWith(root+path.sep))throw Error('候选目录不在本地工作区内。');
  if(await integrationHead(this.config)!==m.baseSha||await git(this.config,['rev-parse','HEAD'],worktree)!==m.sourceSha||await git(this.config,['status','--porcelain'],worktree)||buildFingerprint(worktree)!==checks.artifactHash)throw Error('基线、候选版本或构建产物已变化，不能恢复验收。');
  if(checks.tests.total<this.store.get('baselineChecks').tests.total)throw Error('测试数量低于基线，不能恢复验收。');
  const diff=await git(this.config,['diff','--no-ext-diff','--unified=3',m.baseSha,m.sourceSha],worktree),files=(await git(this.config,['diff','--name-only',m.baseSha,m.sourceSha],worktree)).split('\n').filter(Boolean),kinds=await git(this.config,['diff','--name-status',m.baseSha,m.sourceSha],worktree);
  if(files.length>this.config.maxChangedFiles||Buffer.byteLength(diff)>this.config.maxDiffBytes||files.some(file=>!allowedPath(file,m.scopeFiles||[]))||/(?:^|\n)[DR]/.test(kinds)||/(?:new file|new) mode 120000/.test(diff)||unsafeDiffReason(diff)||/(?:wtk_|fmtopat_|mob_)[a-zA-Z0-9_-]{15,}|sk-[a-zA-Z0-9_-]{20,}/.test(diff))throw Error('候选变更不满足范围或安全要求，不能恢复验收。');
  const release=await this.release(worktree,m.sourceSha,checks.artifactHash);await this.apps.start('stage',release);
  try{
   if(buildFingerprint(release)!==checks.artifactHash||await integrationHead(this.config)!==m.baseSha)throw Error('测试版或基线在恢复时发生变化。');
   const db=await appDatabase(this.config);let feedback;
   const warning=`部分需求待真人验证：${disposition.summary}`;
   try{
    const current=db.getFeedback(task.feedbackId,actor.id);
    if(!current||current.handlingMode!=='HUMAN'||current.status!=='IN_PROGRESS'||current.agentRevision!==(m.feedbackRevision||0))throw Error('反馈状态已变化，请刷新后重新检查。');
    feedback=db.reviewFeedback(task.feedbackId,actor.id,{status:'IN_PROGRESS',reply:`候选版通过代码检查和独立评审；${warning} 两名真人验收后才能更新。`,handlingMode:'AGENT',expectedAgentRevision:current.agentRevision});
   }finally{db.close();}
   const qa=m.findings.qa;
   const next=this.store.transition(task.id,'WAITING_ACCEPTANCE',{handlingMode:'AGENT',feedbackStatus:feedback.status,feedbackRevision:feedback.agentRevision,sourceSha:m.sourceSha,release,artifactHash:checks.artifactHash,stageUrl:this.config.stageUrl,checks,review:m.review,qa,qaDisposition:disposition,resumeStage:null,repairPending:false,lastCallFailure:null,reason:warning});
   this.store.event(task.id,'qa_unverified',warning,{sourceSha:m.sourceSha,unverifiedChecks:disposition.unverifiedChecks,blockedCapabilities:disposition.blockedCapabilities,recovered:true,actor:actor.name});
   return next;
  }catch(error){await this.apps.stop('stage');throw error;}
 }
 async accept(task,actor,sha,decision,note){
  if(!['approve','reject'].includes(decision))throw Error('无效的验收结果。');
  if(decision==='reject'&&task.state!=='WAITING_ACCEPTANCE'&&this.store.approvals(task.id).some(item=>item.sourceSha===sha&&item.decision==='reject'))return;
  await this.ensureEligible(task);
  if(decision==='reject'&&note.trim().length<8)throw Error('请至少填写 8 字，说明验收未通过的原因、复现步骤或期望效果，Agent 将据此继续修复。');
  const approvals=this.store.approve(task.id,actor,sha,decision,note);
  if(decision==='reject'){
   const feedback=await this.updateFeedback(task,'IN_PROGRESS',`真人验收未通过，已交回 Agent 修复：${note}`,{handlingMode:'AGENT',requestAgent:true,agentInstructions:`${actor.name} 对候选版本 ${sha} 的验收反馈：\n${note}`,agentRequestKey:`acceptance:${sha}`});
   this.store.syncFeedback(feedback);this.store.set('pendingPromotion',null);
   await this.apps.stop('stage');requestCleanup(this.store,'真人验收未通过，保留修复目录');this.store.event(task.id,'acceptance_repair_queued','已保存验收意见并交回 Agent；自动运行暂停时可手动处理。',{sourceSha:sha,note});return;
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
   if(previous)this.store.set('previousRelease',previous);this.store.set('currentRelease',{sourceSha:sha,root:task.metadata.release});this.store.set('baselineChecks',task.metadata.checks);this.store.transition(task.id,'ACCEPTED',{reason:'两名真人已验收，通过本地集成；未发布生产环境。'});await this.updateFeedback(task,'COMPLETED','两名真人验收通过，已更新本地集成版本。');
   let workspaceSync;
   try{workspaceSync=await syncAcceptedWorkspace(this.config,task);}catch(error){workspaceSync={state:'ERROR',sourceSha:sha,message:'验收运行版已更新，开发目录同步未完成：'+error.message};}
   this.store.set('workspaceSync',workspaceSync);this.store.transition(task.id,'ACCEPTED',{workspaceSync,acceptedAppUrl:this.config.appUrl});
   this.store.event(task.id,'workspace_sync',workspaceSync.message,workspaceSync);
   recordLocalUpdate(this.store,task,'SUCCEEDED',workspaceSync.state==='SYNCED'?`本地运行版已更新（${this.config.appUrl}），开发目录已同步验收改动。`:`本地运行版已更新（${this.config.appUrl}）。${workspaceSync.message}`,workspaceSync.state==='SYNCED'?'complete':'workspace_pending');
   await this.apps.stop('stage');requestCleanup(this.store,'验收通过并完成本地更新');
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
