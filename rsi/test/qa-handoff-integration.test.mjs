import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {Pipeline} from '../lib/pipeline.mjs';
import {buildFingerprint} from '../lib/checks.mjs';

test('tooling limitation sends the same reviewed candidate to two-person acceptance as unverified',async()=>{
 const home=mkdtempSync(path.join(tmpdir(),'worktrace-qa-handoff-'));const root=path.join(home,'repo');const store=new Store(':memory:');
 const git=(args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  mkdirSync(path.join(root,'src/lib'),{recursive:true});mkdirSync(path.join(root,'.next'),{recursive:true});
  writeFileSync(path.join(root,'.gitignore'),'.next\n');writeFileSync(path.join(root,'src/lib/markdown-editing.ts'),'export const value = 1;\n');writeFileSync(path.join(root,'.next/BUILD_ID'),'test-build');
  git(['init']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','candidate']);
  const sha=git(['rev-parse','HEAD']),hash=buildFingerprint(root);
  const task=store.enqueue({id:'f1',title:'编辑日志',description:'检查编辑',category:'SUGGESTION'});
  const checks={passed:true,sourceSha:sha,artifactHash:hash,tests:{total:1},results:[]};
  store.set('baselineChecks',{tests:{total:1}});
  store.transition(task.id,'STAGING',{handlingMode:'AGENT',feedbackStatus:'IN_PROGRESS',scopeFiles:['src/lib/markdown-editing.ts'],acceptance:['检查编辑'],baseSha:sha,sourceSha:sha,worktree:root,files:[],resumeStage:'STAGING',resumeRound:1,checks,review:{verdict:'Approve',sourceSha:sha,summary:'独立评审通过'}});
  const started=[];const config={home,projectRoot:root,stageUrl:'http://127.0.0.1:3042',appUrl:'http://127.0.0.1:3040',browserChannel:'',maxRepairRounds:5,maxChangedFiles:12,maxDiffBytes:100000};
  const pipeline=new Pipeline(config,store,{start:async(...args)=>started.push(args),stop:async()=>{}},{});
  pipeline.ensureEligible=async()=>{};pipeline.prepareTask=async t=>t;pipeline.updateFeedback=async()=>{};pipeline.release=async()=>root;
  pipeline.taskAgent=async(_task,options)=>{assert.equal(options.role,'qa');return {passed:false,failureKind:'tooling',summary:'多图粘贴无法验证',checks:[{name:'多图粘贴',passed:false,evidence:'工具不支持'}],blockedCapabilities:['multi_image_paste'],observations:[]};};
  await pipeline.processTask(store.find(task.id));
  const result=store.find(task.id);assert.equal(result.state,'WAITING_ACCEPTANCE');assert.equal(result.metadata.qa.passed,false);assert.equal(result.metadata.qaDisposition.status,'unverified');
  assert.match(result.metadata.reason,/未完成/);assert.equal(result.metadata.sourceSha,sha);assert.equal(started[0][0],'stage');
  const draft=JSON.parse(readFileSync(path.join(home,'tasks',task.id,'local-pr.json'),'utf8'));assert.equal(draft.qaDisposition.status,'unverified');assert.equal(draft.review.sourceSha,sha);
  assert.equal(store.approvals(task.id).length,0);
 }finally{store.close();rmSync(home,{recursive:true,force:true});}
});
