export function taskFailureAction(task,error,{aborted=false,maxInfrastructureFailures=3,infrastructureFailures}={}){
 const retryAttempt=(task.metadata.retryAttempt||0)+1;
 if(aborted)return {state:'QUEUED',metadata:{retryAttempt,reason:'服务已停止，任务已保留；重新启动后会自动继续。'}};
 if(error.code==='AGENT_QUOTA')return {state:'QUEUED',metadata:{retryAttempt,reason:'今日 Agent 额度用完，已排队等待下一日额度。'}};
 if(error.retryable){const infrastructureRetries=infrastructureFailures??(task.metadata.infrastructureRetries||0)+1;const detail={kind:error.failureKind||'transient',message:error.message,at:new Date().toISOString()};if(infrastructureRetries<maxInfrastructureFailures)return {state:'QUEUED',metadata:{retryAttempt,infrastructureRetries,lastCallFailure:detail,reason:`调用暂时失败（累计 ${infrastructureRetries}/${maxInfrastructureFailures} 次），保留当前代码和阶段，五分钟后继续：${error.message}`}};return {state:'ESCALATED',metadata:{infrastructureRetries,lastCallFailure:detail,escalationKind:'infrastructure',reason:`调用故障累计达到 ${maxInfrastructureFailures} 次，代码和阶段已保留，需检查服务连接：${error.message}`}};}
 return {state:'ESCALATED',metadata:{reason:error.message}};
}
export function agentFailure(result){
 const messages=[];
 for(const line of (result.out||'').split('\n'))try{const event=JSON.parse(line);if(event.type==='error'||event.type==='turn.failed'||event.item?.type==='error'){const value=event.error?.message||event.item?.message||event.message;if(typeof value==='string')messages.push(value);}}catch{}
 const raw=(messages.at(-1)||result.err||'').slice(-1200);
 const message=raw.replace(/Bearer\s+[A-Za-z0-9._-]+/gi,'Bearer [REDACTED]').replace(/(?:wtk_|fmtopat_|mob_|sk-)[A-Za-z0-9_-]{12,}/g,'[REDACTED]').replace(/[\r\n]+/g,' ').slice(0,400);
 if(/unauthorized|authentication|invalid.api.key|refresh.token|not.logged.in|\b(?:401|403)\b/i.test(raw))return {kind:'authentication',retryable:false,message:'模型认证不可用，请检查已有登录。'+(message?' '+message:'')};
 if(result.timedOut)return {kind:'transient',retryable:true,message:'Agent 本次调用超时，已保留代码和输出。'};
 if(/workspace routing discovery failed|connection|network|timed? ?out|timeout|temporar|reconnecting|rate.limit|too many requests|overloaded|service.unavailable|\b(?:429|500|502|503|504)\b|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|stream.*(?:disconnect|closed)/i.test(raw))return {kind:'transient',retryable:true,message:'模型服务连接暂时失败。'+(message?' '+message:'')};
 return {kind:'execution',retryable:false,message:`Agent 执行失败（${result.code}）。${message||'运行记录已保留。'}`};
}
export function callFailureLimit(config,task){return (config.maxInfrastructureFailures||6)+Math.min(1,task?.metadata.manualRetryCount||0)*(config.maxStageAttempts||3);}
export function roleTimeout(config,role){return Math.min(config.agentTimeoutSeconds,role==='triage'?120:role==='scope'?180:role==='reviewer'?240:role==='user'?360:role==='qa'?600:900)*1000;}
