import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {syncAcceptedWorkspace} from '../lib/workspace-sync.mjs';

function fixture(){
 const root=mkdtempSync(path.join(tmpdir(),'rsi-workspace-')),project=path.join(root,'repo');mkdirSync(path.join(project,'src/lib'),{recursive:true});
 const git=args=>execFileSync('git',args,{cwd:project,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const file='src/lib/markdown-sync.ts',other='src/lib/markdown-other.ts',base=Array.from({length:14},(_,i)=>`export const value${i}=${i};`).join('\n')+'\n';
 writeFileSync(path.join(project,file),base);writeFileSync(path.join(project,other),base);
 git(['init']);git(['config','core.autocrlf','false']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','base']);const baseSha=git(['rev-parse','HEAD']);
 const accepted=base.replace('value0=0','value0=100');writeFileSync(path.join(project,file),accepted);writeFileSync(path.join(project,other),accepted);
 git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','accepted']);const sourceSha=git(['rev-parse','HEAD']);
 git(['checkout','--detach',baseSha]);
 return {root,project,git,file,other,base,accepted,config:{projectRoot:project,home:path.join(root,'runtime')},task:{id:'test-task',metadata:{baseSha,sourceSha,scopeFiles:[file,other]}}};
}

test('accepted changes merge into the working copy while preserving local edits, CRLF and the Git index',async()=>{
 const f=fixture();try{
  const local=f.base.replace('value12=12','value12=1200').replaceAll('\n','\r\n');writeFileSync(path.join(f.project,f.file),local);f.git(['add',f.file]);const index=f.git(['diff','--cached']);
  const result=await syncAcceptedWorkspace(f.config,f.task);assert.equal(result.state,'SYNCED');
  const merged=readFileSync(path.join(f.project,f.file),'utf8');assert.match(merged,/value0=100/);assert.match(merged,/value12=1200/);assert.ok(merged.includes('\r\n'));
  assert.equal(f.git(['diff','--cached']),index);assert.equal(f.git(['rev-parse','HEAD']),f.task.metadata.baseSha);
  assert.equal((await syncAcceptedWorkspace(f.config,f.task)).state,'SYNCED');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('a conflict leaves all files untouched and reports that development sources were not synchronized',async()=>{
 const f=fixture();try{
  writeFileSync(path.join(f.project,f.other),f.base.replace('value0=0','value0=99'));const before=[f.file,f.other].map(file=>readFileSync(path.join(f.project,file),'utf8'));
  const result=await syncAcceptedWorkspace(f.config,f.task);assert.equal(result.state,'CONFLICT');assert.deepEqual(result.conflicts,[f.other]);
  assert.deepEqual([f.file,f.other].map(file=>readFileSync(path.join(f.project,file),'utf8')),before);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
