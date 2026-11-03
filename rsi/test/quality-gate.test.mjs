import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {checkCandidate} from '../lib/checks.mjs';

test('task quality gate builds with lint and typecheck without requiring any test suite',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'rsi-quality-'));
 try{
  const cwd=path.join(root,'repo'),home=path.join(root,'runtime');
  mkdirSync(cwd,{recursive:true});
  const scripts={
   'typescript/bin/tsc':'process.exit(0);',
   'next/dist/bin/next':"const {mkdirSync,writeFileSync}=require('node:fs');mkdirSync('.next',{recursive:true});writeFileSync('.next/BUILD_ID','synthetic-build');",
   'vitest/vitest.mjs':"throw Error('Test suites must not run in the task gate.');"
  };
  writeFileSync(path.join(cwd,'.gitignore'),'.next\n');
  const project=path.join(root,'project');mkdirSync(project,{recursive:true});mkdirSync(path.join(project,'rsi/lib'),{recursive:true});writeFileSync(path.join(project,'rsi/lib/outbound-guard.mjs'),'export {};');
  for(const [name,body]of Object.entries(scripts)){const file=path.join(project,'node_modules',name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,body);}
  const lint=path.join(project,'rsi/node_modules/eslint/bin/eslint.js');mkdirSync(path.dirname(lint),{recursive:true});writeFileSync(lint,'process.exit(0);');
  const git=args=>execFileSync('git',args,{cwd,stdio:'ignore'});git(['init']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture']);
  const result=await checkCandidate({projectRoot:project,home,stagePort:3042,appUrl:'http://127.0.0.1:3040',controlPort:3044,commandTimeoutSeconds:10},cwd,path.join(home,'checks'));
  assert.equal(result.passed,true);assert.equal(result.tests.required,false);
  assert.deepEqual(result.results.map(item=>item.name),['lint','typecheck','build']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
