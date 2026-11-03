import {readFileSync} from 'node:fs';
import path from 'node:path';

const sessionId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function savedWorkerSession(task,root){
 const saved=task?.metadata.workerSession;
 return saved&&sessionId.test(saved.id)&&saved.root===path.resolve(root)?saved.id:null;
}
export function sessionFromLog(directory){
 try{for(const line of readFileSync(path.join(directory,'events.jsonl'),'utf8').split('\n')){
  let event;try{event=JSON.parse(line);}catch{continue;}
  if(event.type==='thread.started'&&sessionId.test(event.thread_id))return event.thread_id;
 }}catch{}
 return null;
}
export function workerVerification(answer,directory){
 const verification=answer?.verification;
 const checks=Array.isArray(verification?.checks)?verification.checks:[];
 let operations=[];
 for(const relative of ['source-trace.jsonl','browser/trace.jsonl'])try{
  operations.push(...readFileSync(path.join(directory,relative),'utf8').split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}));
 }catch{}
 const lastWrite=operations.filter(x=>['patch','write'].includes(x.action)&&x.ok).at(-1)?.at||'';
 const browserActions=new Set(['snapshot','navigate','click','fill','paste','paste_image','select','press','reload','reopen','screenshot','test_account','test_fixture','image_spacing_probe']);
 const observed=operations.some(x=>!x.error&&browserActions.has(x.action)&&x.at>=lastWrite);
 const status=verification?.status==='product_failure'?'product_failure':verification?.status==='passed'&&observed&&checks.length&&checks.every(x=>x.passed===true)?'passed':'unverified';
 return {status,summary:verification?.summary||'做事 Agent 尚未提供完整验证证据，请真人按原始反馈验收。',checks,unverifiedChecks:status==='unverified'?checks.filter(x=>!x.passed).concat(!observed?[{name:'当前代码的实际操作证据',evidence:'缺少修改完成后的实际浏览器操作记录。'}]:[]):[],evidenceDir:path.join(directory,'browser')};
}
