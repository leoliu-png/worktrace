export const localUpdateActive=update=>['QUEUED','RUNNING'].includes(update?.state);

export function recordLocalUpdate(store,task,state,message,phase){
 const previous=store.get('localUpdate'),now=new Date().toISOString(),sourceSha=task.metadata.sourceSha;
 const continuing=previous?.taskId===task.id&&previous.sourceSha===sourceSha&&localUpdateActive(previous);
 const update={taskId:task.id,title:task.title,sourceSha,state,phase,message,startedAt:continuing?previous.startedAt:now,updatedAt:now,finishedAt:['QUEUED','RUNNING'].includes(state)?null:now};
 store.set('localUpdate',update);
 store.event(task.id,'local_update',message,{state,phase,sourceSha});
 return update;
}

// A stopped worker must not leave a permanent "updating" indication on restart.
export function recoverLocalUpdate(store){
 const update=store.get('localUpdate');if(!localUpdateActive(update))return;
 const pending=store.get('pendingPromotion');if(pending?.taskId===update.taskId&&pending.sourceSha===update.sourceSha)return;
 const task=store.find(update.taskId),completed=task?.state==='ACCEPTED'&&task.metadata.sourceSha===update.sourceSha&&store.get('currentRelease')?.sourceSha===update.sourceSha;
 recordLocalUpdate(store,{id:update.taskId,title:update.title,metadata:{sourceSha:update.sourceSha}},completed?'SUCCEEDED':'INTERRUPTED',completed?'服务恢复后已确认本地更新完成。':'上次本地更新已中断，请确认当前版本；不会显示为仍在更新。',completed?'complete':'interrupted');
}
