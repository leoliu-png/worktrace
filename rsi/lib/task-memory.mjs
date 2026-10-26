import {createHash} from 'node:crypto';

// Durable findings, rather than a shared conversation between independent roles.
export function failureRecord(kind,answer,context={}){
 if(!answer)return null;
 if(kind==='review'&&answer.verdict==='Approve'||kind==='browser'&&answer.passed===true)return null;
 const summary=(kind==='developer'?answer.blockedReason:answer.summary)||answer.reason||'';
 const issues=kind==='review'?(answer.findings||[]):kind==='browser'?(answer.checks||[]).filter(item=>item.passed!==true):answer.results?answer.results.filter(item=>!item.passed):[];
 if(!summary&&!issues.length)return null;
 const content={kind,cycle:context.cycle??0,round:context.round??null,sourceSha:context.sourceSha||null,summary,issues,...(answer.logs?{logs:answer.logs}:{} )};
 const id=createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0,20);
 return {id,...content,at:context.at||new Date().toISOString(),evidenceDir:context.evidenceDir||null};
}

export function qaPlan(task){
 const scope=task.metadata.scopeFiles||[],requirements=[task.title,task.description,task.metadata.agentInstructions,...(task.metadata.acceptance||[])].filter(Boolean).join('\n');
 const feedbackScope=scope.some(file=>/^src\/(?:app\/console\/feedback(?:\/|$)|components\/feedback-form(?:\.tsx?|$)|lib\/feedback)/.test(file));
 const storageRequired=/草稿|存储|storage|draft|localStorage/i.test(requirements);
 const feedbackRequired=feedbackScope&&/反馈|feedback|表单|form/i.test(requirements);
 const fixtures=[];
 if(storageRequired)fixtures.push('storage_off','storage_on');
 if(feedbackRequired&&/503|服务失败|服务器失败|提交失败|server.error|submission.failure/i.test(requirements))fixtures.push('server_error_on','server_error_off');
 if(feedbackRequired&&storageRequired)fixtures.push('corrupt_drafts');
 return {scopeFiles:scope,acceptance:task.metadata.acceptance||[],permittedFixtures:fixtures,maySubmitFeedback:feedbackRequired,
  instructions:'只验证当前验收要求及直接相关的回归路径。日志链接任务不测试反馈表单提交。额外发现写入 observations，不能使无关任务验收失败。点击的 navigationAttempts 是工具拦截的实际导航请求，不需要访问外部页面。'};
}

export function promptTask(task,{reviewer=false}={}){
 const memory=(task.metadata.failureMemory||[]).filter(item=>!reviewer||item.kind!=='developer');
 return {id:task.id,title:task.title,description:task.description,category:task.category,metadata:{scopeFiles:task.metadata.scopeFiles,previousScopeFiles:task.metadata.previousScopeFiles,files:task.metadata.files,acceptance:task.metadata.acceptance,agentInstructions:task.metadata.agentInstructions,repairCycle:task.metadata.repairCycle,sourceSha:task.metadata.sourceSha,failureMemory:memory,qaPlan:qaPlan(task)}};
}
