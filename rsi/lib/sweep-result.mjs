// An agent can finish its model call without completing the requested scenario.
export function recordSweepResult(store,answer,{directory,index}){
 if(!['completed','blocked'].includes(answer.outcome))throw Error('巡检未返回有效完成状态。');
 const at=new Date().toISOString();
 if(answer.outcome==='blocked'){
  const reason=(answer.blockedReason||answer.summary||'巡检受阻').slice(0,1000);
  store.set('lastSweepAttempt',{state:'FAILED',at,summary:reason});
  store.event(null,'sweep_failed',`巡检未完成：${reason}`,{directory,feedbackSubmitted:answer.feedbackSubmitted});
  return;
 }
 store.set('sweepIndex',index+1);
 store.set('lastSweep',{at,answer,directory});
 store.event(null,'sweep_finished',answer.summary,{directory,feedbackSubmitted:answer.feedbackSubmitted});
 store.set('lastSweepAttempt',{state:'COMPLETED',at,summary:answer.summary});
}
