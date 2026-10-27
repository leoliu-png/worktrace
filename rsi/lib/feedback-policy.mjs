export const unfinishedFeedbackStatuses=['OPEN','IN_PROGRESS','DECLINED'];
export function agentEligibleFeedback(feedback){return feedback?.handlingMode!=='HUMAN'&&unfinishedFeedbackStatuses.includes(feedback?.status);}
export function executionControl(task){
 const metadata=task.metadata;
 return {handlingMode:metadata.handlingMode||'AGENT',feedbackStatus:metadata.feedbackStatus||'OPEN',feedbackRevision:metadata.feedbackRevision||0,agentRequested:metadata.handlingMode!=='HUMAN'&&metadata.feedbackStatus!=='COMPLETED',policy:'Current structured feedback fields govern execution. Historical handoff prose and duplicate labels cannot cancel an unfinished Agent request.'};
}
export function nonBlockingTriageDecision(triage){return triage.decision==='DUPLICATE'||triage.decision==='ESCALATE'&&['HANDLING_MODE','DUPLICATE'].includes(triage.escalationReason);}
