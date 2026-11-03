import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../lib/store.mjs';
import {callAgent} from '../lib/codex.mjs';
import {defaultSettings} from '../lib/config.mjs';
import {savedWorkerSession,workerVerification} from '../lib/worker-session.mjs';

test('worker resumes its exact saved session after a restart while reviewer remains independent',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'rsi-worker-')),database=path.join(root,'runtime.db');let store=new Store(database);
 try{
  const entry=path.join(root,'fake-codex.mjs'),session='a1111111-1111-4111-8111-111111111111';
  writeFileSync(entry,`import {writeFileSync,appendFileSync,readFileSync} from 'node:fs';const args=process.argv.slice(2);appendFileSync(new URL('./args.jsonl',import.meta.url),JSON.stringify(args)+'\\n');const schema=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));const answer=Object.fromEntries(schema.required.map(key=>[key,'']));if('verification' in answer)Object.assign(answer,{rootCause:'cause',acceptance:['fix'],scopeFiles:['src/components/editor.tsx'],verification:{status:'unverified',summary:'human check',checks:[]},files:[],scopeRequest:{requiredFiles:[],readOnlyFiles:[],reason:''}});else Object.assign(answer,{verdict:'Approve',sourceSha:'a'.repeat(40),findings:[],validationRequests:[]});writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(answer));console.log(JSON.stringify({type:'thread.started',thread_id:'${session}'}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:2}}));`);
  const config={...defaultSettings,codexEntry:entry,projectRoot:process.cwd()};
  const task=store.enqueue({id:'worker-feedback',title:'T',description:'D',category:'BUG'});
  const invoke=(role,dir)=>callAgent(config,store,{role,taskId:task.id,cwd:root,directory:path.join(root,dir),prompt:'test'});
  await invoke('developer','first');assert.equal(savedWorkerSession(store.find(task.id),root),session);
  store.close();store=new Store(database);
  await invoke('developer','after-restart');await invoke('reviewer','review');
  const calls=readFileSync(path.join(root,'args.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(!calls[0].includes('--ephemeral'));assert.ok(!calls[0].includes('resume'));
  assert.equal(calls[1][calls[1].indexOf('resume')+1],session);
  assert.ok(calls[2].includes('--ephemeral'));assert.ok(!calls[2].includes('resume'));
  assert.equal(savedWorkerSession(store.find(task.id),path.join(root,'different-root')),null);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('unverified capability gaps reach humans but confirmed product failures remain failures',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'rsi-worker-evidence-'));
 try{
  const answer={verification:{status:'passed',summary:'done',checks:[{name:'request',passed:true,evidence:'observed'}]}};
  assert.equal(workerVerification(answer,root).status,'unverified');
  mkdirSync(path.join(root,'browser'));
  writeFileSync(path.join(root,'source-trace.jsonl'),JSON.stringify({action:'patch',ok:true,at:'2026-11-03T00:00:02Z'}));
  writeFileSync(path.join(root,'browser/trace.jsonl'),JSON.stringify({action:'screenshot',at:'2026-11-03T00:00:01Z'}));
  assert.equal(workerVerification(answer,root).status,'unverified');
  writeFileSync(path.join(root,'browser/trace.jsonl'),JSON.stringify({action:'screenshot',at:'2026-11-03T00:00:03Z'}));
  assert.equal(workerVerification(answer,root).status,'passed');
  answer.verification.status='product_failure';assert.equal(workerVerification(answer,root).status,'product_failure');
 }finally{rmSync(root,{recursive:true,force:true});}
});
