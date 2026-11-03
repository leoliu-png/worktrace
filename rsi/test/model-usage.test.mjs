import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {callAgent} from '../lib/codex.mjs';
import {defaultSettings,validateSettings} from '../lib/config.mjs';
import {statusReport} from '../lib/status.mjs';

test('model configuration accepts explicit identifiers and rejects invalid options',()=>{
 assert.equal(validateSettings(defaultSettings).agentModel,'gpt-6.1-sol');
 assert.equal(validateSettings({...defaultSettings,agentModel:'test-model.1'}).agentModel,'test-model.1');
 for(const model of ['', 'model --unsafe', '../model'])assert.throws(()=>validateSettings({...defaultSettings,agentModel:model}),/agentModel/);
});

test('diagnosis live status uses the latest source or browser operation',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'rsi-live-operation-')),store=new Store(':memory:');
 try{
  mkdirSync(path.join(dir,'browser'));
  const task=store.enqueue({id:'live-diagnosis',title:'T',description:'D',category:'BUG'});
  const runId=store.startRun(task.id,'diagnosis',{directory:dir,model:'test-model',reasoningEffort:'medium'});
  store.set('appReady',true);store.set('activeProcess',{runId});
  writeFileSync(path.join(dir,'source-trace.jsonl'),JSON.stringify({at:'2026-11-03T01:00:02.000Z',action:'read_many'})+'\n');
  writeFileSync(path.join(dir,'browser/trace.jsonl'),JSON.stringify({at:'2026-11-03T01:00:01.000Z',action:'snapshot'})+'\n');
  assert.equal(statusReport(defaultSettings,store).runtime.agent.lastOperation.message,'批量读取相关源码');
  writeFileSync(path.join(dir,'browser/trace.jsonl'),JSON.stringify({at:'2026-11-03T01:00:03.000Z',action:'image_spacing_probe'})+'\n');
  assert.equal(statusReport(defaultSettings,store).runtime.agent.lastOperation.message,'测量图片粘贴后的实际间距');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('each invocation passes its configured model to Codex and preserves it in task and live status',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'rsi-model-')),store=new Store(':memory:');
 try{
  const entry=path.join(dir,'fake-codex.mjs');
  writeFileSync(entry,`import {writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);writeFileSync(new URL('./args.json',import.meta.url),JSON.stringify(args));\nwriteFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({outcome:'completed',blockedReason:'',summary:'ok',feedbackSubmitted:false,feedbackTitle:'',feedbackDescription:'',evidenceFiles:[]}));\nconsole.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:2,output_tokens:3}}));`);
  const task=store.enqueue({id:'model-feedback',title:'A',description:'B',category:'EXPERIENCE'});
  const config={...defaultSettings,codexEntry:entry,projectRoot:process.cwd(),agentModel:'test-model.1'};
  await callAgent(config,store,{role:'user',taskId:task.id,cwd:dir,directory:dir,prompt:'test'});
  const args=JSON.parse(readFileSync(path.join(dir,'args.json'),'utf8'));
  assert.equal(args[args.indexOf('--model')+1],'test-model.1');
  const run=store.status().tasks[0].agentRuns[0];
  assert.equal(run.model,'test-model.1');assert.equal(run.reasoningEffort,'medium');assert.equal(run.state,'COMPLETED');
  assert.equal(store.status().tasks[0].tokenUsage.total,5);
  const live=store.startRun(task.id,'developer',{model:'model-live',reasoningEffort:'high',repairRound:1});
  store.set('appReady',true);store.set('activeProcess',{runId:live,role:'developer',taskId:task.id});
  const report=statusReport(config,store);assert.equal(report.runtime.agent.model,'model-live');assert.equal(report.runtime.agent.reasoningEffort,'high');
  assert.equal(report.settings.agentModel,'test-model.1');
  const legacy=store.startRun(task.id,'triage',{});store.finishRun(legacy,'FAILED',{});
  assert.equal(store.status().tasks[0].agentRuns.find(item=>item.id===legacy).model,null);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
