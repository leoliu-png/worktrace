import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {run} from './process.mjs';
import {cleanEnvironment} from './config.mjs';
import {roleTimeout,agentFailure,callFailureLimit} from './retry.mjs';
const string={type:'string'};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const schemas={
 user:object({summary:string,feedbackSubmitted:{type:'boolean'},feedbackTitle:string,feedbackDescription:string,evidenceFiles:{type:'array',items:string}}),
 triage:object({decision:{type:'string',enum:['IMPLEMENT','ESCALATE','DUPLICATE']},summary:string,scopeFiles:{type:'array',items:string},acceptance:{type:'array',items:string},duplicateOf:string}),
 developer:object({summary:string,blockedReason:string,files:{type:'array',items:string}}),
 reviewer:object({verdict:{type:'string',enum:['Approve','Request changes','Escalate']},sourceSha:string,summary:string,findings:{type:'array',items:object({file:string,line:{type:'integer'},problem:string,requestedChange:string})}}),
 qa:object({passed:{type:'boolean'},failureKind:{type:'string',enum:['none','product','tooling']},summary:string,checks:{type:'array',items:object({name:string,passed:{type:'boolean'},evidence:string})},observations:{type:'array',items:object({summary:string,evidence:string})}})
};
function codexEntry(config){if(config.codexEntry&&existsSync(config.codexEntry))return config.codexEntry;for(const directory of (process.env.PATH||process.env.Path||'').split(path.delimiter)){const candidate=path.join(directory,'node_modules/@openai/codex/bin/codex.js');if(existsSync(candidate))return candidate;}throw Error('找不到 Codex CLI。请安装 CLI 或设置 RSI_CODEX_ENTRY。');}
export async function callAgent(config,store,options){
 const max=config.maxStageAttempts||3;
 for(let attempt=1;attempt<=max;attempt++){
  if(options.beforeAttempt)await options.beforeAttempt();
  const failureLimit=callFailureLimit(config,options.taskId?store.find(options.taskId):null);
  if(options.taskId&&store.callFailures(options.taskId)>=failureLimit){const error=Error('此任务的调用故障重试额度已用完，已有代码和阶段已保留。');error.retryable=true;error.failureKind='transient';throw error;}
  const directory=path.join(options.directory,`call-${randomUUID().slice(0,8)}`);
  const browser=options.browser?{...options.browser,evidenceDir:path.join(directory,'browser')}:null;
  try{return await callAttempt(config,store,{...options,directory,browser});}
  catch(error){
   if(!error.retryable||options.signal?.aborted||attempt===max||options.taskId&&store.callFailures(options.taskId)>=failureLimit)throw error;
   const seconds=attempt===1?15:45,nextAt=new Date(Date.now()+seconds*1000).toISOString();
   store.set('agentRetry',{role:options.role,taskId:options.taskId||null,attempt:attempt+1,limit:max,nextAt,message:error.message});
   store.event(options.taskId||null,'agent_reconnecting',`${seconds} 秒后重试当前阶段（第 ${attempt+1}/${max} 次调用），保留代码和阶段。`,{role:options.role,message:error.message,nextAt});
   try{await delay(seconds*1000,undefined,{signal:options.signal});}finally{store.set('agentRetry',null);}
  }
 }
}
async function callAttempt(config,store,{role,taskId=null,cwd,prompt,directory,browser=null,source=null,signal,repairRound}){
 if(store.countRunsToday()>=config.maxAgentRunsPerDay){const error=Error('今天的 Agent 调用次数已达上限，任务已保留。');error.code='AGENT_QUOTA';throw error;}
 mkdirSync(directory,{recursive:true});
 const schemaFile=path.join(directory,'schema.json'),output=path.join(directory,'answer.json');
 writeFileSync(schemaFile,JSON.stringify(schemas[role],null,2));writeFileSync(path.join(directory,'prompt.txt'),prompt);
 const entry=codexEntry(config),effort=role==='developer'?(config.developerReasoningEffort||'high'):role==='reviewer'?(config.reviewerReasoningEffort||'high'):'medium';
 const task=taskId?store.find(taskId):null;
 const metadata={directory,reasoningEffort:effort,repairCycle:task?.metadata.repairCycle||0,sourceSha:task?.metadata.sourceSha||null,...(role==='developer'?{repairRound,repairCharge:false}:{})};
 const runId=store.startRun(taskId,role,metadata,config.maxRepairRounds);store.event(taskId,'agent_started',`${role} 已开始独立会话`,{runId});
 const args=[entry,'--no-daemon','exec','--ignore-user-config','--ephemeral','--json','--sandbox','read-only','-c','approval_policy="never"','-c',`model_reasoning_effort=${JSON.stringify(effort)}`,'-c','web_search="disabled"','-c','features.apps=false','-c','features.multi_agent=false','-c','features.skip_host_skill_discovery=true','-c','features.in_app_browser=false','-c','features.computer_use=false','-c','features.image_generation=false','-c','features.shell_tool=false','--output-schema',schemaFile,'--output-last-message',output,'-'];
 if(source){const settingsFile=path.join(directory,'source-settings.json');writeFileSync(settingsFile,JSON.stringify({...source,directory}));const entry=path.join(config.projectRoot,'rsi/bin/source-mcp.mjs');args.splice(-1,0,'-c',`mcp_servers.rsi_source.command=${JSON.stringify(process.execPath.replaceAll('\\','/'))}`,'-c',`mcp_servers.rsi_source.args=${JSON.stringify([entry.replaceAll('\\','/'),settingsFile.replaceAll('\\','/')])}`,'-c','mcp_servers.rsi_source.required=true','-c','mcp_servers.rsi_source.enabled_tools=["source_action"]','-c','mcp_servers.rsi_source.tools.source_action.approval_mode="approve"');}
 if(browser){const settingsFile=path.join(directory,'browser-settings.json');writeFileSync(settingsFile,JSON.stringify(browser));const entry=path.join(config.projectRoot,'rsi/bin/browser-mcp.mjs');args.splice(-1,0,'-c',`mcp_servers.rsi_browser.command=${JSON.stringify(process.execPath.replaceAll('\\','/'))}`,'-c',`mcp_servers.rsi_browser.args=${JSON.stringify([entry.replaceAll('\\','/'),settingsFile.replaceAll('\\','/')])}`,'-c','mcp_servers.rsi_browser.required=true','-c','mcp_servers.rsi_browser.startup_timeout_sec=45','-c','mcp_servers.rsi_browser.enabled_tools=["browser_action"]','-c','mcp_servers.rsi_browser.tools.browser_action.approval_mode="approve"');}
 try{
  const result=await run(process.execPath,args,{cwd,env:cleanEnvironment(),input:prompt,timeout:roleTimeout(config,role),logFile:path.join(directory,'events.jsonl'),signal,onPid:pid=>store.set('activeProcess',{pid,runId,role,taskId,at:new Date().toISOString()})});
  if(result.code!==0){const failure=signal?.aborted?{kind:'interrupted',retryable:false,message:'Agent 已随服务停止，进度已保留。'}:agentFailure(result);const error=Error(failure.message);error.retryable=failure.retryable;error.failureKind=failure.kind;throw error;}
  let answer;try{answer=JSON.parse(readFileSync(output,'utf8'));if(!answer||typeof answer!=='object'||Array.isArray(answer)||schemas[role].required.some(key=>!(key in answer)))throw Error('Invalid answer');}catch{const error=Error('Agent 未返回符合要求的结果，已有改动保留，准备重试当前阶段。');error.retryable=true;error.failureKind='output';throw error;}
  if(browser){const trace=path.join(browser.evidenceDir,'trace.jsonl');if(!existsSync(trace)||!readFileSync(trace,'utf8').trim())throw Error('浏览器工具没有实际执行，不能把此轮记录为无问题。');}
  store.finishRun(runId,'COMPLETED',{...metadata,repairCharge:role==='developer',answer});store.set('activeProcess',null);return browser?{...answer,_rsiEvidenceDir:browser.evidenceDir}:answer;
 }catch(error){let writes=false;const trace=path.join(directory,'source-trace.jsonl');if(source&&existsSync(trace))for(const line of readFileSync(trace,'utf8').split('\n'))try{const event=JSON.parse(line);if(event.action==='write'&&event.ok===true)writes=true;}catch{}store.finishRun(runId,'FAILED',{...metadata,repairCharge:role==='developer'&&writes,error:error.message,failureKind:error.failureKind||'execution',retryable:error.retryable===true});store.set('activeProcess',null);throw error;}
}
