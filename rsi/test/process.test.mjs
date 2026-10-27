import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {run} from '../lib/process.mjs';

test('commands retain output and exit status, including durable logs',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'worktrace-process-'));
 try{const logFile=path.join(directory,'events.log');const result=await run(process.execPath,['-e','console.log("saved");console.error("problem");process.exitCode=7'],{logFile,timeout:5000});assert.equal(result.code,7);assert.match(result.out,/saved/);assert.match(result.err,/problem/);assert.match(readFileSync(logFile,'utf8'),/saved/);}
 finally{assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));rmSync(directory,{recursive:true});}
});

test('timeout and abort settle even when a command does not exit itself',async()=>{
 for(const abort of [false,true]){const controller=new AbortController(),started=Date.now();const timer=abort?setTimeout(()=>controller.abort(),300):null;
  try{const result=await run(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:abort?5000:300,signal:controller.signal});assert.equal(result.code,-1);assert.equal(result.timedOut,!abort);assert.equal(result.aborted,abort);assert.ok(Date.now()-started<4500);}
  finally{clearTimeout(timer);}
 }
});

test('a descendant holding stdout cannot keep an exited command running',async()=>{
 let descendant;
 try{const started=Date.now();const result=await run(process.execPath,['-e',`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{windowsHide:true,stdio:['ignore',process.stdout,process.stderr]});console.log(child.pid);child.unref();process.exit(0);`],{timeout:7000});descendant=Number(result.out.trim());assert.ok(Number.isInteger(descendant)&&descendant>0);assert.equal(result.code,0);assert.ok(Date.now()-started<4500);}
 finally{if(descendant)try{process.kill(descendant);}catch{}}
});

test('invalid command and unavailable log destination fail without hanging',async()=>{
 await assert.rejects(run('worktrace-command-that-does-not-exist',[],{timeout:1000}));
 await assert.rejects(run(process.execPath,['-e','process.exit(0)'],{logFile:tmpdir(),timeout:1000}));
});
