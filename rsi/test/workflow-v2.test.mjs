import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {defaultSettings} from '../lib/config.mjs';
import {sourceAccess} from '../lib/source-access.mjs';
import {callAgent} from '../lib/codex.mjs';

test('per-cycle budgets stop new invocations and retain all historical usage',async()=>{
 const store=new Store(':memory:');try{
  const task=store.enqueue({id:'budget',title:'T',description:'D',category:'BUG'});
  const id=store.startRun(task.id,'diagnosis',{workflowVersion:2});
  store.finishRun(id,'COMPLETED',{workflowVersion:2,repairCycle:0});
  store.db.prepare('UPDATE runs SET metadata=? WHERE id=?').run(JSON.stringify({workflowVersion:2,repairCycle:0,tokenUsage:{input:500000,output:5,total:500005}}),id);
  const budgetSettings={...defaultSettings,maxTaskTokens:500000};
  assert.equal(store.workflowBudget(task.id,budgetSettings).exhausted,true);
  await assert.rejects(()=>callAgent(budgetSettings,store,{role:'diagnosis',taskId:task.id}),error=>error.code==='TASK_BUDGET');
  assert.equal(store.countRunsToday(),1);
  store.transition(task.id,'QUEUED',{repairCycle:1});assert.equal(store.workflowBudget(task.id,defaultSettings).exhausted,false);
  assert.equal(store.status().tasks[0].tokenUsage.total,500005);
 }finally{store.close();}
});
test('styles and dependency snippets are readable, bounded and never permit dependency writes',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'rsi-context-'));try{
  mkdirSync(path.join(root,'src/app'),{recursive:true});mkdirSync(path.join(root,'node_modules/codemirror-live-markdown/dist'),{recursive:true});
  writeFileSync(path.join(root,'src/app/styles.css'),'.image { margin: 1px; }');
  writeFileSync(path.join(root,'node_modules/codemirror-live-markdown/dist/index.js'),Array.from({length:500},(_,i)=>`line ${i+1}`).join('\n'));
  const access=sourceAccess(root,['src/app/styles.css']);
  const css=access.read('src/app/styles.css');access.patch(css.file,'margin: 1px','margin: 0',css.sha256);
  assert.match(access.read(css.file).content,/margin: 0/);
  const lib='node_modules/codemirror-live-markdown/dist/index.js';
  assert.equal(access.read(lib,{query:'line 400'}).hits[0].line,400);
  assert.equal(access.read(lib,{startLine:390,endLine:410}).content.split('\n').length,21);
  assert.throws(()=>access.write(lib,'bad',null));assert.throws(()=>access.read('node_modules/other-package/dist/index.js'));
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('tool startup failures stop before any paid agent run is registered',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'rsi-preflight-')),store=new Store(':memory:');
 try{const task=store.enqueue({id:'preflight',title:'T',description:'D',category:'BUG'});
  await assert.rejects(()=>callAgent({...defaultSettings,projectRoot:root},store,{role:'diagnosis',taskId:task.id,cwd:root,directory:root,prompt:'test',source:{root,scope:[]}}),error=>error.code==='TOOL_PREFLIGHT');
  assert.equal(store.countRunsToday(),0);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
