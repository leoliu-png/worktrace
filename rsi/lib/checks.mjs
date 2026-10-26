import path from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {run} from './process.mjs';
import {appEnvironment} from './local-app.mjs';
import {git} from './git.mjs';
export function testFailureDetails(report){
 return (report.testResults||[]).flatMap(file=>(file.assertionResults||[]).filter(item=>item.status==='failed').map(item=>({file:file.name,name:item.fullName||item.title,messages:(item.failureMessages||[]).map(message=>String(message).slice(-10000))})));
}
export function checkFailureLogs(checks,directory){
 const logs=checks.results.filter(item=>!item.passed).map(item=>{let text='';try{text=readFileSync(path.join(directory,item.log),'utf8').slice(-14000);}catch{}return {name:item.name,text};});
 if(checks.results.some(item=>item.name==='test'&&!item.passed)){
  try{const failures=testFailureDetails(JSON.parse(readFileSync(path.join(directory,'tests.json'),'utf8')));if(failures.length)logs.push({name:'test assertions',text:JSON.stringify(failures,null,2)});}catch{}
  if(checks.results.some(item=>item.name==='test'&&item.runtimeTestsPassed===false))try{logs.push({name:'runtime tests',text:readFileSync(path.join(directory,'runtime-test.log'),'utf8').slice(-16000)});}catch{}
 }
 return logs;
}
export async function checkCandidate(config,cwd,directory,{signal,baseline=false}={}){
 mkdirSync(directory,{recursive:true});const sourceSha=await git(config,['rev-parse','HEAD'],cwd);if(await git(config,['status','--porcelain'],cwd))throw Error('检查要求已提交且干净的代码。');
 const env={...appEnvironment(config,config.stagePort),LOCAL_DATABASE_PATH:path.join(directory,'checks.db'),RSI_CONTROL_TOKEN:'',RSI_CONTROL_URL:''};
 const rootModules=path.join(config.projectRoot,'node_modules'),runtimeModules=path.join(config.projectRoot,'rsi/node_modules');
 const entries=[['lint',[path.join(runtimeModules,'eslint/bin/eslint.js'),'--config',path.join(config.projectRoot,'rsi/eslint.config.mjs'),'src','--max-warnings','0']],['typecheck',[path.join(rootModules,'typescript/bin/tsc'),'--noEmit','--incremental','false']],['test',[path.join(rootModules,'vitest/vitest.mjs'),'run','--reporter=json','--outputFile='+path.join(directory,'tests.json')]],['build',[path.join(rootModules,'next/dist/bin/next'),'build']]];
 const results=[];
 for(const [name,args]of entries){const started=Date.now();const result=await run(process.execPath,args,{cwd,env:{...env,NODE_ENV:name==='test'?'test':'production'},timeout:config.commandTimeoutSeconds*1000,logFile:path.join(directory,name+'.log'),signal});let runtimePassed=true;if(name==='test'){const testFiles=readdirSync(path.join(config.projectRoot,'rsi/test')).filter(file=>file.endsWith('.test.mjs')).map(file=>path.join(config.projectRoot,'rsi/test',file));const runtime=await run(process.execPath,['--test',...testFiles],{cwd:config.projectRoot,env,timeout:60000,logFile:path.join(directory,'runtime-test.log'),signal});runtimePassed=runtime.code===0;}results.push({name,passed:result.code===0&&runtimePassed,exitCode:result.code===0&&!runtimePassed?1:result.code,durationMs:Date.now()-started,log:name+'.log',...(name==='test'?{runtimeTestsPassed:runtimePassed}:{})});}
 const unchanged=sourceSha===await git(config,['rev-parse','HEAD'],cwd)&&!(await git(config,['status','--porcelain'],cwd));
 let tests;try{const data=JSON.parse(readFileSync(path.join(directory,'tests.json'),'utf8'));tests={total:data.numTotalTests,passed:data.numPassedTests,failed:data.numFailedTests,success:data.success,failures:testFailureDetails(data)};}catch{tests={total:0,passed:0,failed:0,success:false,failures:[]};}
 const artifactHash=results.find(x=>x.name==='build')?.passed?buildFingerprint(cwd):null;
 const summary={sourceSha,sourceUnchanged:unchanged,artifactHash,passed:unchanged&&results.every(x=>x.passed)&&tests.success&&tests.total>0,results,tests,at:new Date().toISOString(),baseline};
 writeFileSync(path.join(directory,'checks.json'),JSON.stringify(summary,null,2));return summary;
}
export function buildFingerprint(cwd){const root=path.join(cwd,'.next'),hash=createHash('sha256');function visit(relative=''){for(const item of readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(relative,item.name);if(file.split(path.sep).includes('cache')||file==='trace')continue;if(item.isDirectory())visit(file);else if(item.isFile())hash.update(file.replaceAll('\\','/')).update(readFileSync(path.join(root,file)));}}visit();return hash.digest('hex');}
