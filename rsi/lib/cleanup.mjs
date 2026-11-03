import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,realpathSync,lstatSync} from 'node:fs';
import {readdir,lstat,unlink,rmdir} from 'node:fs/promises';
import Database from 'better-sqlite3';
import {run} from './process.mjs';
import {cleanEnvironment} from './config.mjs';
import {checkout} from './git.mjs';

const canonical=value=>path.resolve(value).replaceAll('\\','/').toLowerCase();
const inside=(value,root)=>canonical(value).startsWith(canonical(root)+'/');
const alive=pid=>{try{if(!Number.isInteger(pid)||pid<=0)return false;process.kill(pid,0);return true;}catch{return false;}};
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=(file,value)=>writeFileSync(file,JSON.stringify(value,null,2));
const git=(config,args,options={})=>run('git',args,{cwd:config.projectRoot,env:cleanEnvironment(),timeout:30000,...options});
const unfinished=task=>!['ACCEPTED','CLOSED'].includes(task.state)&&task.metadata.handlingMode!=='HUMAN'&&task.metadata.feedbackStatus!=='COMPLETED';

export function requestCleanup(store,reason){
 if(!store.get||!store.set)return;
 if(store.get('cleanupRequested'))return;
 store.set('cleanupRequested',{id:randomUUID(),requestedAt:new Date().toISOString(),reason});
}
function tasksFrom(db){return db.prepare('SELECT * FROM tasks').all().map(row=>({id:row.id,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at,metadata:JSON.parse(row.metadata)}));}
function settingsFrom(db){return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(row=>[row.key,JSON.parse(row.value)]));}
function roots(config){
 const result=[{root:path.join(config.home,'worktrees'),home:config.home,fixture:false}];
 for(const name of existsSync(config.home)?requireDirectories(config.home):[]){if(/^v\d+-verification-\d+$/.test(name)&&existsSync(path.join(config.home,name,'runtime.db')))result.push({root:path.join(config.home,name,'worktrees'),home:path.join(config.home,name),fixture:true});}
 // Additional historical fixtures require an explicit local allowlist, never a request path.
 try{for(const item of JSON.parse(readFileSync(path.join(config.home,'cleanup','extra-roots.json'),'utf8'))){if(item.fixture===true&&/^trial-\d{8}$/.test(path.basename(item.root))&&canonical(path.dirname(item.root))===canonical(path.dirname(config.home)))result.push({root:path.resolve(item.root),home:null,fixture:true});}}catch{}
 return result;
}
import {readdirSync} from 'node:fs';
function requireDirectories(root){return readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.isSymbolicLink()).map(x=>x.name);}
function ownerOf(config,target){
 if(canonical(target)===canonical(config.projectRoot))return null;
 for(const owner of roots(config)){
  if(canonical(path.dirname(target))!==canonical(owner.root))continue;
  if(!existsSync(owner.root)||lstatSync(owner.root).isSymbolicLink()||canonical(realpathSync(owner.root))!==canonical(owner.root))continue;
  if(!/^(?:task|baseline|context|release|restored)-[a-z0-9-]+$/.test(path.basename(target))&&!(owner.fixture&&!owner.home&&/^(?:development|lab|stage(?:-final|-round-\d+)?)$/.test(path.basename(target))))continue;
  if(existsSync(target)&&(lstatSync(target).isSymbolicLink()||canonical(realpathSync(target))!==canonical(target)))continue;
  return owner;
 }
 return null;
}
export async function registeredWorktrees(config){
 const result=await git(config,['worktree','list','--porcelain']);if(result.code!==0)throw Error('无法读取 Git 工作目录，已停止清理。');
 return result.out.trim().split(/\r?\n\r?\n/).filter(Boolean).map(block=>{const lines=block.split(/\r?\n/);return {path:lines.find(x=>x.startsWith('worktree '))?.slice(9),head:lines.find(x=>x.startsWith('HEAD '))?.slice(5),locked:lines.some(x=>x.startsWith('locked'))};}).filter(x=>x.path);
}
function protectedReferences(settings,tasks,{fixture=false,finished=false}={}){
 const protectedPaths=new Map(),add=(value,reason)=>{if(value)protectedPaths.set(canonical(value),reason);};
 const running=['baselineRuntime','stageRuntime','previewRuntime'].map(key=>settings[key]).filter(item=>alive(item?.pid));
 for(const item of running)add(item.root,'仍被本地服务进程使用');
 if(!fixture){add(settings.currentRelease?.root,'当前运行版本');add(settings.previousRelease?.root,'上一可回滚版本');}
 const busy=alive(settings.activeProcess?.pid);
 for(const task of tasks){
  const m=task.metadata;
  if((!finished&&unfinished(task))||busy&&settings.activeProcess?.taskId===task.id||settings.pendingPromotion?.taskId===task.id){
   add(m.worktree,'未完成任务唯一的修复目录');
   if(task.state==='WAITING_ACCEPTANCE'||settings.pendingPromotion?.taskId===task.id)add(m.release,'等待真人验收的构建');
  }
 }
 return {protectedPaths,busy,running};
}
export async function planCleanup(config,store){
 const worktrees=await registeredWorktrees(config),tasks=tasksFrom(store.db),settings=settingsFrom(store.db);
 if(!settings.previousRelease&&settings.currentRelease){
  const accepted=tasks.find(t=>t.state==='ACCEPTED'&&t.metadata.sourceSha===settings.currentRelease.sourceSha),priorSha=accepted?.metadata.baseSha;
  const prior=worktrees.filter(w=>w.head===priorSha&&ownerOf(config,w.path)&&existsSync(path.join(w.path,'.next','BUILD_ID'))).sort((a,b)=>Number(path.basename(b.path).startsWith('release-'))-Number(path.basename(a.path).startsWith('release-')))[0];
  if(prior){settings.previousRelease={sourceSha:prior.head,root:prior.path};store.set('previousRelease',settings.previousRelease);}
 }
 const main=protectedReferences(settings,tasks),owners=new Map();
 for(const owner of roots(config)){
  if(!owner.home||canonical(owner.home)===canonical(config.home))continue;
  let db;try{
   db=new Database(path.join(owner.home,'runtime.db'),{readonly:true,fileMustExist:true});const foreignSettings=settingsFrom(db),foreignTasks=tasksFrom(db);
   const lease=db.prepare('SELECT expires FROM lease WHERE id=1').get();
   const finished=existsSync(path.join(owner.home,'result.json'))&&!alive(foreignSettings.activeProcess?.pid)&&!['baselineRuntime','stageRuntime','previewRuntime'].some(key=>alive(foreignSettings[key]?.pid));
   const refs=protectedReferences(foreignSettings,foreignTasks,{fixture:true,finished});owners.set(canonical(owner.root),{...refs,tasks:foreignTasks,foreignBusy:refs.busy||Boolean(lease&&lease.expires>Date.now())});
  }catch{owners.set(canonical(owner.root),{foreignBusy:true,tasks:[],protectedPaths:new Map()});}finally{db?.close();}
 }
 const entries=worktrees.map(worktree=>{
  const owner=ownerOf(config,worktree.path);if(!owner)return {...worktree,action:'keep',reason:'主开发目录或未授权管理的工作目录'};
  const other=owners.get(canonical(owner.root)),refs=canonical(owner.home||'')===canonical(config.home)?main:other||{protectedPaths:new Map()};
  const reason=worktree.locked?'工作目录已被锁定':other?.foreignBusy?'另一个运行器正在使用此目录组':main.protectedPaths.get(canonical(worktree.path))||refs.protectedPaths.get(canonical(worktree.path));
  const related=(other?.tasks||tasks).filter(t=>canonical(t.metadata.worktree||'')===canonical(worktree.path)).map(t=>t.id);
  return {...worktree,ownerRoot:owner.root,ownerHome:owner.home,taskIds:related,action:reason?'keep':'remove',reason:reason||'已结束任务或不再引用的历史副本'};
 });
 return {at:new Date().toISOString(),entries,busy:main.busy,current:settings.currentRelease,rollback:settings.previousRelease,removeCount:entries.filter(x=>x.action==='remove').length,keepCount:entries.filter(x=>x.action==='keep').length};
}
async function snapshot(config,entry,directory){
 const options={cwd:entry.path},head=await git(config,['rev-parse','HEAD'],options),status=await git(config,['status','--porcelain','-uall'],options),diff=await git(config,['diff','--no-ext-diff','--no-textconv','--binary','HEAD'],options),untracked=await git(config,['ls-files','--others','--exclude-standard','-z'],options),ignored=await git(config,['ls-files','--others','--ignored','--exclude-standard','--directory','-z'],options);
 if([head,status,diff,untracked,ignored].some(x=>x.code!==0))throw Error('无法完整保存工作目录状态。');
 if([status,diff,untracked,ignored].some(x=>Buffer.byteLength(x.out)>1900000))throw Error('工作目录状态超过完整归档上限，保留原目录。');
 const personal=ignored.out.split('\0').filter(Boolean).filter(file=>! /^(?:\.next\/|node_modules\/|rsi\/node_modules\/|\.vite\/|[^/]+\.tsbuildinfo$)/.test(file));
 if(personal.length)throw Error('目录包含被 Git 忽略的配置或数据，已保留：'+personal.slice(0,3).join('、'));
 const files=[];let bytes=0;
 for(const relative of untracked.out.split('\0').filter(Boolean)){
  if(path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>part==='..'||part==='.git'))throw Error('未提交文件路径不安全。');
  const target=path.resolve(entry.path,relative);if(!inside(target,entry.path))throw Error('未提交文件越出工作目录。');
  let cursor=entry.path;for(const part of relative.split(/[\\/]/)){cursor=path.join(cursor,part);if(lstatSync(cursor).isSymbolicLink())throw Error('未提交文件包含链接，保留目录等待人工处理。');}
  if(lstatSync(target).size+bytes>50*1024*1024)throw Error('未提交文件超过归档上限，保留原目录。');
  const content=readFileSync(target);bytes+=content.length;
  const destination=path.join(directory,'untracked',relative);mkdirSync(path.dirname(destination),{recursive:true});writeFileSync(destination,content);files.push({path:relative,sha256:digest(content)});
 }
 writeFileSync(path.join(directory,'changes.patch'),diff.out);writeFileSync(path.join(directory,'status.txt'),status.out);
 const sha=head.out.trim();if(!/^[a-f0-9]{40}$/.test(sha))throw Error('无法保存源码版本。');
 if((await git(config,['update-ref','refs/rsi/archive/'+sha,sha])).code!==0)throw Error('无法保留源码提交。');
 const record={path:entry.path,head:sha,files,diffHash:digest(diff.out),statusHash:digest(status.out),at:new Date().toISOString()};json(path.join(directory,'archive.json'),record);return record;
}
// No directory links are followed, including node_modules junctions on Windows.
async function removeChildren(target,boundary,{keepGit=false,signal,onBytes}={}){
 if(signal?.aborted)throw Error('清理已中断，目录和归档状态会在下次检查。');
 if(!inside(target,boundary)&&canonical(target)!==canonical(boundary))throw Error('删除路径越出已核对的工作目录。');
 const stat=await lstat(target);if(stat.isSymbolicLink()){await unlink(target);return;}
 if(!stat.isDirectory()){await unlink(target);onBytes?.(stat.size);return;}
 const children=await readdir(target);for(let i=0;i<children.length;i+=24){await Promise.all(children.slice(i,i+24).filter(name=>!(keepGit&&name==='.git')).map(name=>removeChildren(path.join(target,name),boundary,{signal,onBytes})));}
 if(!keepGit)await rmdir(target);
}
export async function removeManagedWorktree(config,entry,{signal,onBytes,onArchive}={}){
 const owner=ownerOf(config,entry.path);if(!owner||canonical(owner.root)!==canonical(entry.ownerRoot))throw Error('目标不在已核对的自动优化目录内。');
 const common=await git(config,['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:entry.path}),expected=await git(config,['rev-parse','--path-format=absolute','--git-common-dir']);
 if(common.code!==0||expected.code!==0||canonical(common.out.trim())!==canonical(expected.out.trim()))throw Error('目标不属于当前 Git 仓库。');
 const journalDirectory=path.join(config.home,'cleanup','inflight');mkdirSync(journalDirectory,{recursive:true});const journalFile=path.join(journalDirectory,digest(canonical(entry.path))+'.json');
 if(existsSync(journalFile)&&JSON.parse(readFileSync(journalFile,'utf8')).state==='REMOVING')throw Error('上次清理中断，原始归档已保留；此目录等待检查，不重复归档部分删除的文件。');
 const directory=path.join(config.home,'cleanup','archives',randomUUID());mkdirSync(directory,{recursive:true});
 const archive=await snapshot(config,entry,directory);
 const diff=await git(config,['diff','--no-ext-diff','--no-textconv','--binary','HEAD'],{cwd:entry.path}),status=await git(config,['status','--porcelain','-uall'],{cwd:entry.path});
 if(diff.code!==0||status.code!==0||digest(diff.out)!==archive.diffHash||digest(status.out)!==archive.statusHash)throw Error('归档后文件变化，停止清理。');
 for(const file of archive.files)if(digest(readFileSync(path.join(entry.path,file.path)))!==file.sha256)throw Error('归档后未提交文件变化，停止清理。');
 const locked=await git(config,['worktree','lock','--reason','WorkTrace cleanup in progress',entry.path]);if(locked.code!==0)throw Error('工作目录无法锁定，未清理。');
 let removed=false;
 try{
  json(journalFile,{state:'REMOVING',path:entry.path,directory,head:archive.head});onArchive?.({...archive,directory});
  // Recheck the absolute root immediately before recursive deletion.
  if(!ownerOf(config,entry.path))throw Error('工作目录边界发生变化。');
  await removeChildren(entry.path,entry.path,{keepGit:true,signal,onBytes});
  await git(config,['worktree','unlock',entry.path]);
  const result=await git(config,['worktree','remove','--force',entry.path]);if(result.code!==0)throw Error('目录清理未完成：'+result.err.slice(0,200));removed=true;json(journalFile,{state:'REMOVED',path:entry.path,directory,head:archive.head});
 }finally{if(!removed)await git(config,['worktree','unlock',entry.path]);}
 return {...archive,directory};
}
export async function cleanupBatch(config,store,{limit=4,signal}={}){
 const request=store.get('cleanupRequested');if(!request)return null;
 if(store.get('currentWork')||alive(store.get('activeProcess')?.pid)||store.get('pendingPromotion'))return {state:'DEFERRED'};
 const plan=await planCleanup(config,store);if(plan.busy)return {state:'DEFERRED'};
 let progress=store.get('cleanupProgress');if(progress?.id!==request.id)progress={...request,startedAt:new Date().toISOString(),state:'RUNNING',removed:0,freedBytes:0,attempted:[],errors:[],records:[]};
 store.set('cleanupProgress',progress);
 const pending=plan.entries.filter(x=>x.action==='remove'&&!progress.attempted.includes(canonical(x.path)));
 for(const entry of pending.slice(0,limit)){
  if(signal?.aborted)break;
  progress.currentPath=entry.path;store.set('cleanupProgress',progress);
  try{
   // References are live: never execute a stale dry-run plan.
   const latest=(await planCleanup(config,store)).entries.find(x=>canonical(x.path)===canonical(entry.path));if(latest?.action!=='remove')throw Error('目录已重新被引用，保留。');
   let freed=0;const archive=await removeManagedWorktree(config,latest,{signal,onBytes:bytes=>{freed+=bytes;},onArchive:archive=>{
    if(entry.ownerHome&&canonical(entry.ownerHome)===canonical(config.home))for(const id of entry.taskIds){const task=store.find(id);if(task)store.transition(id,task.state,{artifactCleanup:{state:'REMOVING',at:new Date().toISOString(),archive:archive.directory,removedPath:entry.path},...(task.state==='ACCEPTED'?{}:{archivedCandidate:{head:archive.head,baseSha:task.metadata.baseSha,directory:archive.directory}})});}
   }});
   progress.removed++;progress.freedBytes+=freed;progress.records.push({path:entry.path,head:archive.head,archive:archive.directory,freedBytes:freed});
   if(entry.ownerHome&&canonical(entry.ownerHome)===canonical(config.home))for(const id of entry.taskIds){const task=store.find(id);if(task){const metadata={artifactCleanup:{state:'REMOVED',at:new Date().toISOString(),archive:archive.directory,removedPath:entry.path}};if(canonical(task.metadata.worktree||'')===canonical(entry.path)){metadata.archivedCandidate=task.state==='ACCEPTED'?null:{head:archive.head,baseSha:task.metadata.baseSha,directory:archive.directory};metadata.worktree=null;metadata.archivedWorkerSession=task.metadata.workerSession;metadata.workerSession=null;}store.transition(id,task.state,metadata);}}
  }catch(error){progress.errors.push({path:entry.path,message:error.message});}
  progress.attempted.push(canonical(entry.path));store.set('cleanupProgress',progress);
 }
 const remaining=pending.filter(x=>!progress.attempted.includes(canonical(x.path))).length;
 Object.assign(progress,{currentPath:null,remaining,kept:plan.entries.filter(x=>x.action==='keep').map(x=>({path:x.path,reason:x.reason})),updatedAt:new Date().toISOString()});
 if(!remaining&&!signal?.aborted){progress.state=progress.errors.length?'COMPLETED_WITH_ERRORS':'COMPLETED';progress.finishedAt=new Date().toISOString();store.set('lastCleanup',progress);store.set('cleanupRequested',null);store.set('cleanupProgress',null);store.set('nextCleanup',new Date(Date.now()+6*3600000).toISOString());store.event(null,'cleanup_finished',`自动清理完成：移除 ${progress.removed} 个目录，释放约 ${Math.round(progress.freedBytes/1024/1024)} MB；保留 ${progress.kept.length} 个目录。`,{removed:progress.removed,freedBytes:progress.freedBytes,errors:progress.errors});}
 else store.set('cleanupProgress',progress);
 const report=path.join(config.home,'cleanup','reports');mkdirSync(report,{recursive:true});json(path.join(report,request.id+'.json'),progress);return progress;
}
export async function restoreArchivedCandidate(config,task){
 const archived=task.metadata.archivedCandidate;if(!archived||existsSync(task.metadata.worktree||'')&&task.metadata.artifactCleanup?.state!=='REMOVING')return null;
 const base=path.join(config.home,'cleanup','archives'),directory=path.resolve(archived.directory||'');if(!inside(directory,base)||!existsSync(path.join(directory,'archive.json')))throw Error('候选归档路径无效。');
 const archive=JSON.parse(readFileSync(path.join(directory,'archive.json'),'utf8'));if(archive.head!==archived.head||!/^[a-f0-9]{40}$/.test(archive.head))throw Error('候选归档版本不一致。');
 const root=await checkout(config,`restored-${task.id.slice(0,12)}-${archive.head.slice(0,8)}-${path.basename(directory).slice(0,8)}`,archive.head,{branch:true});
 if((await git(config,['status','--porcelain','-uall'],{cwd:root})).out.trim())throw Error('恢复目录已有修改，请人工核对。');
 const patch=path.join(directory,'changes.patch');if(digest(readFileSync(patch))!==archive.diffHash)throw Error('候选补丁归档校验失败。');
 if(readFileSync(patch).length){const result=await git(config,['apply','--binary',patch],{cwd:root});if(result.code!==0)throw Error('候选补丁无法恢复。');}
 for(const file of archive.files){const target=path.resolve(root,file.path);if(!inside(target,root)||file.path.split(/[\\/]/).includes('node_modules'))throw Error('候选文件路径无效。');const data=readFileSync(path.join(directory,'untracked',file.path));if(digest(data)!==file.sha256)throw Error('候选文件归档校验失败。');mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,data);}
 return {worktree:root,baseSha:archived.baseSha,sourceSha:archived.head,workerSession:null,artifactCleanup:{state:'RESTORED',archive:directory,at:new Date().toISOString()},reason:'已从归档恢复候选代码，使用新的工作目录继续处理。'};
}
