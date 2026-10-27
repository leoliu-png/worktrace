import {openSync,closeSync,fstatSync,readSync} from 'node:fs';
import path from 'node:path';
import {taskPolicy,processingBlock} from './task-policy.mjs';
import {callFailureLimit,roleTimeout} from './retry.mjs';
import {localUpdateActive} from './local-update.mjs';
const roles={user:'用户体验 Agent',triage:'反馈整理 Agent',scope:'范围规划与审查 Agent',developer:'开发 Agent',reviewer:'独立评审 Agent',qa:'浏览器复测 Agent'};
const stages={TRIAGING:'整理反馈',SCOPING:'复核修改范围',DEVELOPING:'开发修改',VERIFYING:'检查代码',REVIEWING:'独立评审',STAGING:'部署与浏览器复测'};
function lastOperation(run){
 if(!run?.metadata.directory)return null;
 const filename=path.join(run.metadata.directory,['developer','triage','scope'].includes(run.role)?'source-trace.jsonl':'browser/trace.jsonl');
 let fd;try{fd=openSync(filename,'r');const size=fstatSync(fd).size,buffer=Buffer.alloc(Math.min(size,32768));readSync(fd,buffer,0,buffer.length,Math.max(0,size-buffer.length));const lines=buffer.toString('utf8').trim().split('\n');for(let i=lines.length-1;i>=0;i--){let item;try{item=JSON.parse(lines[i]);}catch{continue;}const action={list:'查看允许的源码文件',read:'读取源码',write:'写入修改',snapshot:'查看页面内容',navigate:'打开页面',click:'点击页面控件',fill:'填写测试内容',select:'选择表单选项',press:'操作编辑器',reload:'刷新页面',reopen:'重新打开页面',screenshot:'保存截图证据',test_account:'切换测试成员',test_fixture:'检查异常情况'}[item.action];if(action)return {message:item.error?'上一步操作未完成，Agent 正在处理':`${action}${item.file?'：'+String(item.file).slice(0,180):item.name?'：'+String(item.name).slice(0,80):''}`,at:item.at};}}catch{}finally{if(fd!==undefined)closeSync(fd);}return null;
}
export function statusReport(config,store){
 const status=store.status(),work=store.get('currentWork'),activeProcess=store.get('activeProcess'),activeRun=activeProcess&&status.runs.find(run=>run.id===activeProcess.runId&&run.state==='RUNNING');
 const activeTask=status.tasks.find(task=>stages[task.state]),waiting=status.tasks.find(task=>task.state==='WAITING_ACCEPTANCE'),queued=status.tasks.filter(task=>task.state==='QUEUED');
 const processRequested=store.get('processRequested'),processBlocked=processingBlock(config,store,processRequested?store.find(processRequested.taskId):store.next());
 const callRetry=store.get('agentRetry'),sweepRequested=store.get('sweepRequested',false),backoffUntil=store.get('backoffUntil'),backoff=backoffUntil&&Date.parse(backoffUntil)>Date.now(),quota=status.agentRunsToday>=config.maxAgentRunsPerDay;
 const localUpdate=store.get('localUpdate'),promotion=store.get('pendingPromotion'),updating=localUpdateActive(localUpdate)||Boolean(promotion);
 const overdue=activeRun&&Date.now()-Date.parse(activeRun.startedAt)>roleTimeout(config,activeRun.role)+5000;
 const sweep=store.get('lastSweep'),sweepAttempt=store.get('lastSweepAttempt'),lastSweep=sweepAttempt?.state==='FAILED'&&(!sweep||sweepAttempt.at>sweep.at)?{at:sweepAttempt.at,summary:`巡检未完成：${sweepAttempt.summary}`} : sweep?{at:sweep.at,summary:sweep.answer?.summary}:null;
 const recentUpdate=localUpdate?.finishedAt&&Date.now()-Date.parse(localUpdate.finishedAt)<(['FAILED','INTERRUPTED'].includes(localUpdate.state)?300000:60000);
 let state='IDLE',title='自动运行已开启，当前空闲',description='当前没有 Agent 在执行，等待新反馈或下一次巡检。';
 if(updating){state='MANUAL';title='正在本地更新';description=localUpdateActive(localUpdate)?`${localUpdate.title}：${localUpdate.message}`:'两名验收人已通过，正在准备应用已验收的本地版本。';}
 else if(!store.get('appReady')){state='STARTING';title='正在准备本地应用';description=store.get('phase','准备运行环境');}
 else if(callRetry){state='RETRYING';title='当前阶段调用暂时失败，正在等待重试';description=`${roles[callRetry.role]||'Agent'} 将进行第 ${callRetry.attempt}/${callRetry.limit} 次调用，已有代码和阶段保留。${callRetry.message}`;}
 else if(overdue){state='BACKOFF';title='本次 Agent 调用已超时';description='尚未取得有效结果，正在回收调用。后台服务在线不代表 Agent 正常执行，本轮不会被记录为成功。';}
 else if(activeRun||work||activeTask){state=status.enabled?'RUNNING':work?.kind==='sweep'||work?.manual?'MANUAL':'PAUSING';title=activeRun?`${roles[activeRun.role]||'Agent'} 正在执行`:activeTask?`正在${stages[activeTask.state]}`:work?.kind==='sweep'?'正在执行一次用户体验巡检':'正在执行任务';description=work?.kind==='sweep'?'体验本地界面，发现有依据的新问题时提交反馈。':activeTask?.title||work?.title||'当前任务正在处理。';if(work?.manual)description+=' 本次为手动触发的一条反馈优化，完成后等待真人验收，自动运行开关保持不变。';if(!status.enabled)description+=work?.kind==='sweep'?' 本次为手动巡检，结束后保持暂停。':work?.manual?' 本次执行结束后保持暂停。':' 自动运行已暂停，本次执行结束后停止接收新任务。';}
 else if(processRequested){state='MANUAL_PENDING';title=processBlocked?'手动优化正在等待执行条件':'一条手动优化已排队';description=`${processRequested.title}。${processBlocked||'服务空闲后执行筛选、开发、检查、评审和浏览器复测。'} 自动运行开关保持不变。`;}
 else if(recentUpdate){state='LOCAL_UPDATE_RESULT';title=localUpdate.state==='SUCCEEDED'?'本地更新完成':localUpdate.state==='CANCELLED'?'本地更新已取消':localUpdate.state==='INTERRUPTED'?'本地更新已中断':'本地更新失败';description=`${localUpdate.title}：${localUpdate.message}`;}
 else if(!status.enabled){state='PAUSED';title=sweepRequested&&quota?'手动巡检等待调用额度恢复':'自动运行已暂停';description=sweepRequested?(quota?'今天的调用额度已用完，手动巡检将等待北京时间次日 00:00 后执行；自动运行仍保持暂停。':'已安排一次手动巡检，空闲时执行；自动运行仍保持暂停。'):'当前没有 Agent 在执行。点击“继续自动运行”启动定时任务，或点击“巡检一次”仅执行一轮体验。';}
 else if(quota){state='QUOTA';title='今日 Agent 调用额度已用完';description='队列和记录已保留，将在北京时间次日 00:00 后自动继续。';}
 else if(backoff){state='BACKOFF';title='临时失败后等待自动重试';description='服务仍在线，退避后从中断阶段继续；调用故障与代码修复轮次分别计数。';}
 else if(waiting){state='WAITING_ACCEPTANCE';title='测试版已就绪，等待真人验收';description='该任务没有 Agent 在执行，需两名不同账号的真人检查同一个版本。';}
 else if(sweepRequested){title='一次手动巡检已排队';description='当前没有 Agent 在执行，服务空闲后启动这次巡检。';}
 else if(queued.length&&status.tasksToday>=config.maxTasksPerDay){state='QUOTA';title='今日开发任务额度已用完';description='新反馈已排队，等待下一日开发任务额度。';}
 const nextMidnight=new Date(Math.floor((Date.now()+8*3600000)/86400000)*86400000+16*3600000).toISOString();
 const nextSweep=status.enabled?(quota?nextMidnight:status.nextSweep):null;
 return {...status,serverTime:new Date().toISOString(),settings:Object.fromEntries(Object.keys(config).filter(key=>['enabled','sweepMinutes','pollSeconds','maxTasksPerDay','maxAgentRunsPerDay','maxRepairRounds','maxStageAttempts','maxVerificationAttempts','maxInfrastructureFailures'].includes(key)).map(key=>[key,config[key]])),appReady:store.get('appReady',false),phase:store.get('phase','启动中'),appUrl:config.appUrl,stageUrl:config.stageUrl,localOnly:true,tasks:status.tasks.map(task=>({...task,policy:{...taskPolicy(task,store.repairRoundsUsed(task.id),config.maxRepairRounds),...store.repairStats(task.id),callFailureLimit:callFailureLimit(config,task)}})),runtime:{state,title,description,callRetry,agent:activeRun?{role:activeRun.role,label:roles[activeRun.role]||'Agent',startedAt:activeRun.startedAt,taskId:activeRun.taskId,lastOperation:lastOperation(activeRun)}:null,startedAt:work?.startedAt||activeTask?.updatedAt||null,queuedTasks:queued.length,humanTasks:status.tasks.filter(task=>task.metadata.handlingMode==='HUMAN'&&task.metadata.feedbackStatus!=='COMPLETED'||['ESCALATED','REJECTED'].includes(task.state)).length,sweepRequested,nextSweep,retryAt:callRetry?.nextAt||(backoff?backoffUntil:null),processRequested,processControl:{allowed:!processRequested&&!processBlocked,reason:processRequested?'已有一条手动优化请求，请等待其结束。':processBlocked},lastManualProcess:store.get('lastManualProcess'),lastSweep}};
}
