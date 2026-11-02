// Tooling gaps are handed to people as unverified, never represented as a pass.
export function browserQaDisposition(qa,evidence=[]){
 if(qa?.failureKind==='product')return {status:'product_failure',summary:qa.summary||'浏览器复测发现产品问题。',unverifiedChecks:[]};
 const checks=Array.isArray(qa?.checks)?qa.checks:[];
 if(qa?.passed===true&&qa.failureKind==='none'&&checks.length>0&&checks.every(item=>item.passed===true)&&evidence.length>0)return {status:'passed',summary:qa.summary||'浏览器复测通过。',unverifiedChecks:[]};
 const unverifiedChecks=checks.filter(item=>item.passed!==true).map(item=>({name:item.name||'未完成的检查',evidence:item.evidence||''}));
 return {status:'unverified',summary:qa?.summary||'浏览器复测未能完成，请真人检查原始验收要求。',unverifiedChecks,blockedCapabilities:Array.isArray(qa?.blockedCapabilities)?qa.blockedCapabilities:[]};
}

export function recoverableToolingResult(task,runs){
 const sha=task.metadata.sourceSha,qa=task.metadata.findings?.qa;
 if(task.state!=='ESCALATED'||task.metadata.escalationKind!=='verification_tooling'||qa?.failureKind!=='tooling')throw Error('只有因浏览器工具不足而暂停的任务可以恢复到真人验收。');
 if(runs.some(run=>run.role==='qa'&&run.state==='COMPLETED'&&run.metadata.sourceSha===sha&&run.metadata.answer?.failureKind==='product'))throw Error('该候选版本曾发现产品问题，不能按工具不足恢复验收。');
 const latest=runs.find(run=>run.role==='qa'&&run.state==='COMPLETED'&&run.metadata.sourceSha===sha);
 if(!latest||latest.metadata.answer?.failureKind!=='tooling'||latest.metadata.answer?.summary!==qa.summary)throw Error('缺少与候选版本一致的浏览器工具不足记录。');
 const checks=task.metadata.checks,review=task.metadata.review;
 if(!sha||!checks?.passed||checks.sourceSha!==sha||!checks.artifactHash||!checks.tests?.success||!['lint','typecheck','test','build'].every(name=>checks.results?.some(item=>item.name===name&&item.passed))||review?.verdict!=='Approve'||review.sourceSha!==sha)throw Error('候选版本未通过完整检查和独立评审，不能进入真人验收。');
 return browserQaDisposition(qa,[]);
}
