import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../lib/store.mjs';
import {Pipeline} from '../lib/pipeline.mjs';
import {controlServer} from '../lib/control-server.mjs';
import {defaultSettings} from '../lib/config.mjs';

test('interrupt preserves the task without automatic rerun and allows admin to resume it',async()=>{
 const home=mkdtempSync(path.join(tmpdir(),'rsi-interrupt-')),store=new Store(':memory:');
 let server;
 try{
  const task=store.enqueue({id:'feedback-interrupt',title:'Test',description:'Test',category:'BUG'});
  const config={...defaultSettings,home,controlPort:0,controlSecret:'test-secret'};
  const pipeline=new Pipeline(config,store,{},{});
  pipeline.ensureEligible=async()=>{};
  pipeline.prepareTask=async()=>{store.transition(task.id,'DEVELOPING',{worktree:'preserved-worktree',resumeStage:'DEVELOPING'});await new Promise((resolve,reject)=>pipeline.abort.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));};
  const running=pipeline.processTask(task);
  await new Promise(resolve=>setImmediate(resolve));
  store.set('currentWork',{kind:'task',taskId:task.id});
  server=await controlServer(config,store,pipeline,{requestSweep:()=>true,shutdown(){},interruptTask(actor){const work=store.get('currentWork');store.set('taskInterruption',{taskId:work.taskId,actor:actor.name});pipeline.abort.abort();return 'stopping';}});
  const url=`http://127.0.0.1:${server.address().port}/control`;
  const post=async(body)=>fetch(url,{method:'POST',headers:{Authorization:'Bearer test-secret','Content-Type':'application/json'},body:JSON.stringify(body)});
  const admin={id:'a',name:'Admin',role:'ADMIN'};
  assert.equal((await post({action:'interrupt',actor:{...admin,role:'MEMBER'}})).status,400);
  assert.equal((await post({action:'interrupt',actor:admin})).status,200);
  await running;
  assert.equal(store.find(task.id).state,'HELD');assert.equal(store.find(task.id).metadata.worktree,'preserved-worktree');
  assert.equal(store.next(),null);assert.equal(store.active(),undefined);
  store.recover();assert.equal(store.find(task.id).state,'HELD');
  assert.equal((await post({action:'resume_task',taskId:task.id,actor:admin})).status,400);
  store.set('taskInterruption',null);
  assert.equal((await post({action:'resume_task',taskId:task.id,actor:admin})).status,200);
  assert.equal(store.find(task.id).state,'QUEUED');assert.equal(store.find(task.id).metadata.worktree,'preserved-worktree');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));store.close();rmSync(home,{recursive:true,force:true});}
});
