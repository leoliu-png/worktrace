import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Pipeline} from '../lib/pipeline.mjs';

test('a new cycle independently reviews preserved files before resuming the candidate',async()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'worktrace-scope-test-'));
 const root=path.join(temp,'repo'),home=path.join(temp,'runtime');
 const run=(args,cwd=root)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  mkdirSync(path.join(root,'src/lib'),{recursive:true});mkdirSync(path.join(root,'src/components'),{recursive:true});
  mkdirSync(path.join(root,'node_modules'),{recursive:true});mkdirSync(path.join(root,'rsi/node_modules'),{recursive:true});
  mkdirSync(path.join(home,'worktrees'),{recursive:true});
  writeFileSync(path.join(root,'.gitignore'),'node_modules\nrsi/node_modules\n');
  writeFileSync(path.join(root,'rsi/placeholder.mjs'),'export {};\n');
  writeFileSync(path.join(root,'src/lib/markdown-editing.ts'),'export const value = 1;\n');
  writeFileSync(path.join(root,'src/components/markdown-editor.tsx'),'export const editor = 1;\n');
  run(['init']);run(['add','.']);run(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','base']);
  const base=run(['rev-parse','HEAD']);const candidate=path.join(home,'worktrees','saved-candidate');
  run(['worktree','add','--detach',candidate,base]);
  writeFileSync(path.join(candidate,'src/lib/markdown-editing.ts'),'export const value = 2;\n');
  writeFileSync(path.join(candidate,'src/components/markdown-editor.tsx'),'export const editor = 2;\n');
  run(['add','.'],candidate);run(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','candidate'],candidate);
  let task={id:'abcdef1234567890',feedbackId:'feedback',title:'编辑日志',description:'修复编辑器',metadata:{scopeFiles:['src/lib/markdown-editing.ts'],acceptance:['修复编辑器'],worktree:candidate,baseSha:base,sourceSha:run(['rev-parse','HEAD'],candidate),scopePreflightComplete:true,resumeStage:'DEVELOPING'}};
  const events=[];const store={find:()=>task,transition:(_id,state,fields={})=>(task={...task,state,metadata:{...task.metadata,...fields}}),event:(_id,type,_message,detail)=>events.push({type,detail}),repairRoundsUsed:()=>0};
  const config={home,projectRoot:root,integrationRef:'refs/heads/codex/rsi-local-integration',maxChangedFiles:12,maxDiffBytes:100000};
  const pipeline=new Pipeline(config,store,{},{adminA:{id:'a'}});pipeline.ensureEligible=async()=>{};pipeline.updateFeedback=async()=>{};
  let reviewCalls=0;pipeline.taskAgent=async(_task,options)=>{assert.equal(options.role,'scope');reviewCalls++;return {decision:'APPROVE',scopeFiles:['src/lib/markdown-editing.ts','src/components/markdown-editor.tsx'],acceptance:['修复编辑器'],alignment:'两个文件共同实现原始编辑器需求',summary:'已核对原有改动'};};
  const result=await pipeline.prepareTask(task,path.join(home,'worktrees'));
  assert.equal(reviewCalls,1);assert.ok(events.some(event=>event.type==='saved_scope_preflight'));
  assert.ok(result.metadata.scopeFiles.includes('src/components/markdown-editor.tsx'));
  assert.equal(result.metadata.sourceSha,run(['rev-parse','HEAD'],candidate));
  assert.equal(run(['status','--porcelain'],candidate),'');
 }finally{rmSync(temp,{recursive:true,force:true});}
});
