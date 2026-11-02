import {createHash} from 'node:crypto';
import {executionControl} from './feedback-policy.mjs';
import {qaCapabilities,qaToolVersion} from './qa-capabilities.mjs';

// Durable findings, rather than a shared conversation between independent roles.
export function failureRecord(kind,answer,context={}){
 if(!answer)return null;
 if(kind==='review'&&answer.verdict==='Approve'||kind==='browser'&&answer.passed===true&&answer.failureKind!=='product')return null;
 const summary=(kind==='developer'?answer.blockedReason:answer.summary)||answer.reason||'';
 const issues=kind==='review'?(answer.findings||[]):kind==='browser'?(answer.checks||[]).filter(item=>item.passed!==true):answer.results?answer.results.filter(item=>!item.passed):[];
 if(!summary&&!issues.length)return null;
 const content={kind,cycle:context.cycle??0,round:context.round??null,sourceSha:context.sourceSha||null,summary,issues,...(answer.logs?{logs:answer.logs}:{} )};
 const id=createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0,20);
 return {id,...content,at:context.at||new Date().toISOString(),evidenceDir:context.evidenceDir||null};
}

export function qaPlan(task){
 const scope=task.metadata.scopeFiles||[],requirements=[task.title,task.description,task.metadata.agentInstructions,...(task.metadata.acceptance||[]),...(task.metadata.review?.validationRequests||[])].filter(Boolean).join('\n');
 const feedbackScope=scope.some(file=>/^src\/(?:app\/console\/feedback(?:\/|$)|components\/feedback-form(?:\.tsx?|$)|lib\/feedback)/.test(file));
 const storageRequired=/草稿|存储|storage|draft|localStorage/i.test(requirements);
 const feedbackRequired=feedbackScope&&/反馈|feedback|表单|form/i.test(requirements);
 const pendingSubmission=feedbackRequired&&/异步|竞态|请求完成前|pending|async|race/i.test(requirements);
 const logScope=scope.some(file=>/^src\/(?:app\/console\/(?:logs|my-logs)(?:\/|$)|components\/.*(?:log|markdown)|lib\/markdown)/.test(file));
 const saveFailureRequired=logScope&&/保存失败|提交失败|失败.*草稿|save.failure|server.error/i.test(requirements);
 const imagePasteRequired=logScope&&/图片|图像|image|paste\s+(?:an?\s+)?(?:image|png)/i.test(requirements);
 const fixtures=[];
 if(storageRequired)fixtures.push('storage_off','storage_on');
 if(feedbackRequired&&/503|服务失败|服务器失败|提交失败|server.error|submission.failure/i.test(requirements))fixtures.push('server_error_on','server_error_off');
 if(feedbackRequired&&storageRequired)fixtures.push('corrupt_drafts');
 if(pendingSubmission)fixtures.push('feedback_submit_hold','feedback_submit_release');
 if(saveFailureRequired)fixtures.push('log_save_error_on','log_save_error_off');
 const requiredCapabilities=[];
 if(imagePasteRequired)requiredCapabilities.push('image_paste','paste_receipts');
 if(/粘贴.{0,10}(?:链接|文本|文字|url)|paste.{0,10}(?:url|text)/i.test(requirements))requiredCapabilities.push('text_paste','paste_receipts');
 if(storageRequired)requiredCapabilities.push('storage_failure');
 if(pendingSubmission)requiredCapabilities.push('feedback_submission_hold','submission_receipts');
 if(saveFailureRequired)requiredCapabilities.push('log_save_failure','submission_receipts');
 if(/链接|跳转|link|navigation/i.test(requirements))requiredCapabilities.push('navigation_receipts');
 return {scopeFiles:scope,acceptance:task.metadata.acceptance||[],validationRequests:task.metadata.review?.validationRequests||[],permittedFixtures:fixtures,maySubmitFeedback:feedbackRequired,feedbackSubmissionLimit:pendingSubmission?2:1,imagePasteAllowed:imagePasteRequired,toolVersion:qaToolVersion,availableCapabilities:qaCapabilities,requiredCapabilities,
  previousVerifiedChecks:Boolean(task.metadata.verificationKey)&&task.metadata.qaProgress?.sourceSha===task.metadata.sourceSha&&task.metadata.qaProgress?.toolVersion===qaToolVersion&&task.metadata.qaProgress?.verificationKey===task.metadata.verificationKey?task.metadata.qaProgress.checks:[],
  coordinatorOnlyChecks:['认证/后端调用边界由源码评审和本地服务隔离配置检查；浏览器只报告实际可观察的请求，不宣称证明服务端没有外部调用。'],
  instructions:'只验证当前验收要求及直接相关的回归路径。日志链接任务不测试反馈表单提交。额外发现写入 observations，不能使无关任务验收失败。点击的 navigationAttempts 是工具拦截的实际导航请求，不需要访问外部页面。'};
}

export function missingQaCapabilities(plan,available=qaCapabilities){
 const supported=new Set(available);return [...new Set(plan.requiredCapabilities||[])].filter(name=>!supported.has(name));
}

export function qaVerificationKey(sourceSha,plan){
 return createHash('sha256').update(JSON.stringify({sha:sourceSha,tool:plan.toolVersion,scope:plan.scopeFiles,acceptance:plan.acceptance,requests:plan.validationRequests,fixtures:plan.permittedFixtures,maySubmitFeedback:plan.maySubmitFeedback,feedbackSubmissionLimit:plan.feedbackSubmissionLimit,imagePasteAllowed:plan.imagePasteAllowed,requiredCapabilities:plan.requiredCapabilities})).digest('hex');
}

export function developerChecklist(task,findings){
 return {acceptance:task.metadata.acceptance||[],historicalFindings:(task.metadata.failureMemory||[]).map(({kind,summary,issues})=>({kind,summary,issues})),latestFindings:findings||null};
}

export function promptTask(task,{reviewer=false,triage=false}={}){
 const memory=(task.metadata.failureMemory||[]).filter(item=>!reviewer||item.kind!=='developer');
 return {id:task.id,title:task.title,description:task.description,category:task.category,executionControl:executionControl(task),metadata:{scopeFiles:task.metadata.scopeFiles,readOnlyContextFiles:task.metadata.readOnlyContextFiles||[],previousScopeFiles:task.metadata.previousScopeFiles,files:task.metadata.files,acceptance:task.metadata.acceptance,agentInstructions:task.metadata.agentInstructions,repairCycle:task.metadata.repairCycle,sourceSha:task.metadata.sourceSha,scopeHistory:(task.metadata.scopeHistory||[]).slice(-5),failureMemory:memory,qaPlan:!triage&&task.metadata.scopeFiles?qaPlan(task):undefined}};
}
