import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../lib/store.mjs';
import {planCleanup,cleanupBatch,requestCleanup,removeManagedWorktree,restoreArchivedCandidate} from '../lib/cleanup.mjs';

function fixture(){
 const root=mkdtempSync(path.join(tmpdir(),'worktrace-gc-')),project=path.join(root,'project'),home=path.join(root,'runtime');
 for(const dir of ['src/lib','rsi','node_modules','rsi/node_modules'])mkdirSync(path.join(project,dir),{recursive:true});
 mkdirSync(path.join(home,'worktrees'),{recursive:true});
 writeFileSync(path.join(project,'.gitignore'),'node_modules\nrsi/node_modules\n.next\n');
 writeFileSync(path.join(project,'src/lib/markdown-value.ts'),'export const value=1;\n');writeFileSync(path.join(project,'rsi/placeholder.mjs'),'export {};\n');writeFileSync(path.join(project,'node_modules/sentinel'),'shared dependency');
 const git=args=>execFileSync('git',args,{cwd:project,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git(['init']);git(['config','core.autocrlf','false']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture']);const sha=git(['rev-parse','HEAD']);
 const add=name=>{const target=path.join(home,'worktrees',name);git(['worktree','add','--detach',target,sha]);return target;};
 const store=new Store(path.join(home,'runtime.db'));
 return {root,project,home,sha,git,add,store,config:{projectRoot:project,home},close(){store.close();assert.ok(root.startsWith(path.resolve(tmpdir())+path.sep));rmSync(root,{recursive:true,force:true});}};
}

test('cleanup protects current, rollback, live candidates and waiting acceptance builds',async()=>{
 const f=fixture();try{
  const current=f.add('baseline-current'),previous=f.add('release-previous'),candidate=f.add('task-waiting'),release=f.add('release-waiting'),old=f.add('context-obsolete');
  f.store.set('currentRelease',{root:current,sourceSha:f.sha});f.store.set('previousRelease',{root:previous,sourceSha:f.sha});
  const task=f.store.enqueue({id:'feedback',title:'T',description:'D',category:'BUG'});f.store.transition(task.id,'WAITING_ACCEPTANCE',{worktree:candidate,release,handlingMode:'AGENT'});
  const plan=await planCleanup(f.config,f.store);assert.equal(plan.entries.find(x=>path.resolve(x.path).toLowerCase()===path.resolve(old).toLowerCase()).action,'remove');
  for(const target of [current,previous,candidate,release])assert.equal(plan.entries.find(x=>path.resolve(x.path).toLowerCase()===path.resolve(target).toLowerCase()).action,'keep');
  requestCleanup(f.store,'test');const result=await cleanupBatch(f.config,f.store,{limit:10});assert.equal(result.removed,1);assert.ok(!existsSync(old));for(const target of [current,previous,candidate,release])assert.ok(existsSync(target));
 }finally{f.close();}
});

test('ended candidates archive uncommitted edits and restore them without deleting linked dependencies',async()=>{
 const f=fixture();try{
  const target=f.add('task-ended');symlinkSync(path.join(f.project,'node_modules'),path.join(target,'node_modules'),'junction');
  mkdirSync(path.join(target,'.next'));symlinkSync(path.join(f.project,'node_modules'),path.join(target,'.next/linked-cache'),'junction');
  writeFileSync(path.join(target,'src/lib/markdown-value.ts'),'export const value=2;\n');writeFileSync(path.join(target,'src/lib/markdown-extra.ts'),'export const extra=3;\n');
  const task=f.store.enqueue({id:'feedback',title:'T',description:'D',category:'BUG'});f.store.transition(task.id,'CLOSED',{worktree:target,baseSha:f.sha,handlingMode:'HUMAN'});
  requestCleanup(f.store,'test');const result=await cleanupBatch(f.config,f.store,{limit:10});assert.equal(result.errors.length,0,JSON.stringify(result.errors));assert.ok(!existsSync(target));
  assert.equal(readFileSync(path.join(f.project,'node_modules/sentinel'),'utf8'),'shared dependency');
  const saved=f.store.find(task.id);assert.equal(saved.metadata.worktree,null);assert.ok(existsSync(path.join(saved.metadata.archivedCandidate.directory,'changes.patch')));
  const restored=await restoreArchivedCandidate(f.config,saved);assert.equal(readFileSync(path.join(restored.worktree,'src/lib/markdown-value.ts'),'utf8'),'export const value=2;\n');assert.equal(readFileSync(path.join(restored.worktree,'src/lib/markdown-extra.ts'),'utf8'),'export const extra=3;\n');
 }finally{f.close();}
});

test('active agents defer cleanup and arbitrary directories cannot be removed',async()=>{
 const f=fixture();try{
  const target=f.add('task-old');f.store.set('activeProcess',{pid:process.pid});requestCleanup(f.store,'test');assert.equal((await cleanupBatch(f.config,f.store)).state,'DEFERRED');assert.ok(existsSync(target));
  await assert.rejects(()=>removeManagedWorktree(f.config,{path:f.project,ownerRoot:path.join(f.home,'worktrees')}),/已核对/);assert.ok(existsSync(path.join(f.project,'.git')));
 }finally{f.close();}
});

test('an interrupted removal retains its original archive and is not re-archived as deleted source',async()=>{
 const f=fixture();try{
  const target=f.add('task-interrupted'),controller=new AbortController();controller.abort();const entry=(await planCleanup(f.config,f.store)).entries.find(x=>path.resolve(x.path).toLowerCase()===path.resolve(target).toLowerCase());let archive;
  await assert.rejects(()=>removeManagedWorktree(f.config,entry,{signal:controller.signal,onArchive:value=>{archive=value;}}),/中断/);
  assert.ok(existsSync(path.join(archive.directory,'archive.json')));assert.ok(existsSync(path.join(target,'src/lib/markdown-value.ts')));
  await assert.rejects(()=>removeManagedWorktree(f.config,entry),/上次清理中断/);
 }finally{f.close();}
});

test('ignored personal configuration or databases keep the entire worktree intact',async()=>{
 const f=fixture();try{
  const target=f.add('task-personal');writeFileSync(path.join(target,'.gitignore'),'node_modules\n.next\n.env\n');writeFileSync(path.join(target,'.env'),'LOCAL_TEST_DATA=preserve');
  requestCleanup(f.store,'test');const result=await cleanupBatch(f.config,f.store,{limit:10});assert.equal(result.removed,0);assert.match(result.errors[0].message,/忽略的配置或数据/);assert.equal(readFileSync(path.join(target,'.env'),'utf8'),'LOCAL_TEST_DATA=preserve');
 }finally{f.close();}
});
