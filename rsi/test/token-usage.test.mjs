import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {parseTokenUsage} from '../lib/token-usage.mjs';

const completed=(input,output)=>JSON.stringify({type:'turn.completed',usage:{input_tokens:input,output_tokens:output,cached_input_tokens:90,reasoning_output_tokens:10}});
test('parse actual turn usage without double counting cached or reasoning tokens',()=>{
 assert.deepEqual(parseTokenUsage(['not json',completed(100,20),completed(40,5)].join('\n')),{input:140,output:25,total:165});
 assert.equal(parseTokenUsage('{"type":"turn.completed","usage":{"input_tokens":3}}'),null);
});
test('task usage aggregates all runs and cycles, preserving missing and ongoing calls',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'rsi-usage-'));
 const store=new Store(':memory:');
 try{
  const a=store.enqueue({id:'a',title:'A',description:'A',category:'EXPERIENCE'}),b=store.enqueue({id:'b',title:'B',description:'B',category:'EXPERIENCE'});
  writeFileSync(path.join(dir,'events.jsonl'),completed(100,25));
  const one=store.startRun(a.id,'triage',{directory:dir});store.finishRun(one,'COMPLETED',{directory:dir});
  const two=store.startRun(a.id,'reviewer',{directory:dir});store.finishRun(two,'FAILED',{directory:dir});
  const old=store.startRun(a.id,'scope',{});store.db.prepare("UPDATE runs SET state='FAILED',finished_at=? WHERE id=?").run(new Date().toISOString(),old);
  store.startRun(a.id,'qa',{});
  const other=store.startRun(b.id,'triage',{directory:dir});store.finishRun(other,'COMPLETED',{directory:dir});
  assert.deepEqual(store.status().tasks.find(t=>t.id===a.id).tokenUsage,{input:200,output:50,total:250,recorded:2,missing:1,running:1});
  assert.deepEqual(store.status().tasks.find(t=>t.id===b.id).tokenUsage,{input:100,output:25,total:125,recorded:1,missing:0,running:0});
  assert.equal(JSON.parse(store.db.prepare('SELECT metadata FROM runs WHERE id=?').get(old).metadata).tokenUsage,null);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('historical logs are recovered once and retained after log removal',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'rsi-usage-')),store=new Store(':memory:');
 try{
  const task=store.enqueue({id:'history',title:'H',description:'H',category:'EXPERIENCE'});
  writeFileSync(path.join(dir,'events.jsonl'),completed(13,7));
  const run=store.startRun(task.id,'reviewer',{directory:dir});store.db.prepare("UPDATE runs SET state='COMPLETED',finished_at=? WHERE id=?").run(new Date().toISOString(),run);
  assert.equal(store.status().tasks[0].tokenUsage.total,20);
  rmSync(path.join(dir,'events.jsonl'));
  assert.equal(store.status().tasks[0].tokenUsage.total,20);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
