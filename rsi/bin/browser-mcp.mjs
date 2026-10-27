// Product runtime browser for unattended local agents; never attaches to a person's browser profile.
import {readFileSync,mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {installStorageFailure,applyFixture} from '../lib/browser-fixtures.mjs';
import {fixtureCookieName} from '../lib/local-login.mjs';
import {qaCapabilities,qaToolVersion} from '../lib/qa-capabilities.mjs';
const settings=JSON.parse(readFileSync(process.argv[2],'utf8'));
const origin=new URL(settings.url).origin;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Only the configured local app is allowed.');
mkdirSync(settings.evidenceDir,{recursive:true});
const browser=await chromium.launch({headless:true,...(settings.channel&&settings.channel!=='chromium'?{channel:settings.channel}:{})});
const context=await browser.newContext({viewport:{width:1360,height:960},locale:'zh-CN'});
await context.addInitScript(installStorageFailure);let failPosts=false,failLogSaves=false,holdSubmissions=false;
const submissions=[],pendingSubmissions=new Map(),submissionRequests=new WeakMap();
const pastes=[],blockedRequests=[];
function submissionEvent(entry,phase,detail={}){Object.assign(entry,{phase,at:new Date().toISOString()},detail);appendFileSync(path.join(settings.evidenceDir,'submissions.jsonl'),JSON.stringify(entry)+'\n');}
function setSubmissionHold(hold){
 holdSubmissions=hold;
 if(!hold)for(const [sequence,release]of pendingSubmissions){pendingSubmissions.delete(sequence);release(true);}
 return {holding:hold,pending:pendingSubmissions.size,submissions:submissions.slice(-5)};
}
context.on('response',response=>{const entry=submissionRequests.get(response.request());if(entry){let destination;try{const redirect=response.headers()['x-action-redirect']?.split(';')[0]||response.headers().location;if(redirect){const url=new URL(redirect,origin);if(url.origin===origin)destination=url.pathname+url.search;}}catch{}submissionEvent(entry,'response_received',{status:response.status(),...(destination?{destination}:{})});}});
context.on('requestfailed',request=>{const entry=submissionRequests.get(request);if(entry&&entry.phase!=='fixture_failed')submissionEvent(entry,'request_failed',{failure:request.failure()?.errorText});});
const navigationAttempts=[];
function navigationAttempt(value){
 const entry={sequence:navigationAttempts.length+1,at:new Date().toISOString(),...value};
 navigationAttempts.push(entry);appendFileSync(path.join(settings.evidenceDir,'navigation.jsonl'),JSON.stringify(entry)+'\n');
}
await context.exposeBinding('__rsiRecordWindowOpen',(source,value)=>{
 try{if(new URL(source.frame.url()).origin!==origin||typeof value?.url!=='string')return;const target=new URL(value.url,source.frame.url());navigationAttempt({method:'window.open',url:target.href.slice(0,2000),sourceUrl:source.frame.url(),external:target.origin!==origin,phase:'requested'});}catch{}
});
await context.exposeBinding('__rsiRecordHistory',(source,value)=>{
 try{
  if(new URL(source.frame.url()).origin!==origin||!['pushState','replaceState','popstate'].includes(value?.method)||typeof value?.url!=='string')return;
  const target=new URL(value.url,source.frame.url());if(target.origin!==origin)return;
  navigationAttempt({method:`history.${value.method}`,url:target.href.slice(0,2000),sourceUrl:source.frame.url(),external:false,phase:'committed_local'});
 }catch{}
});
// Fixed instrumentation records the application's real window.open call, without granting caller scripts.
await context.addInitScript(()=>{
 const original=window.open;
 window.open=function(url,target,features){
  try{void window.__rsiRecordWindowOpen({url:String(url??'')}).catch(()=>{});}catch{}
  return original.call(window,url,target,features);
 };
 // Next.js client routing updates history without a document navigation request.
 // Record the actual committed URL after the native call, never an anchor's href.
 const recordHistory=method=>{try{void window.__rsiRecordHistory({method,url:window.location.href}).catch(()=>{});}catch{}};
 for(const method of ['pushState','replaceState']){
  const originalHistory=history[method];
  history[method]=function(...args){const result=originalHistory.apply(this,args);recordHistory(method);return result;};
 }
 window.addEventListener('popstate',()=>recordHistory('popstate'));
});
await context.route('**/*',async route=>{
 try{
  const request=route.request(),url=new URL(request.url()),navigation=request.isNavigationRequest();
  const navigationAllowed=!navigation||/^\/(?:console(?:\/(?:logs(?:\/[^?#]*)?|my-logs|feedback))?)?\/?$/.test(url.pathname);
  const allowed=url.origin===origin&&navigationAllowed&&!url.pathname.startsWith('/console/admin')&&!url.pathname.startsWith('/_rsi/');
  if(navigation)navigationAttempt({method:'navigation',url:url.href.slice(0,2000),blocked:!allowed,external:url.origin!==origin,phase:allowed?'allowed_local':'blocked_by_local_policy'});
  if(allowed){
   const feedbackPost=request.method()==='POST'&&url.pathname==='/console/feedback';
   const logPost=request.method()==='POST'&&/^\/console\/logs\/(?:new|[a-f0-9-]+\/edit)\/?$/.test(url.pathname);
   if(settings.testFixtures===true&&settings.maySubmitFeedback===false&&feedbackPost)return route.abort('blockedbyclient');
   let entry;
   if(feedbackPost||logPost){entry={sequence:submissions.length+1,url:url.href,kind:logPost?'work_log':'feedback'};submissions.push(entry);submissionRequests.set(request,entry);submissionEvent(entry,'request_observed');}
   if(failPosts&&feedbackPost){submissionEvent(entry,'fixture_failed',{status:503,serverExecuted:false});return route.fulfill({status:503,contentType:'text/plain',body:'Synthetic local service failure'});}
   if(settings.testFixtures===true&&failLogSaves&&logPost){submissionEvent(entry,'fixture_failed',{method:'abort_local_save_before_server',serverExecuted:false});return route.abort('failed');}
   if(settings.testFixtures===true&&settings.maySubmitFeedback===true&&feedbackPost&&holdSubmissions){
    submissionEvent(entry,'held');
    const released=await new Promise(resolve=>{
     const timer=setTimeout(()=>{pendingSubmissions.delete(entry.sequence);submissionEvent(entry,'timed_out');resolve(false);},90000);
     pendingSubmissions.set(entry.sequence,proceed=>{clearTimeout(timer);submissionEvent(entry,proceed?'released':'cancelled');resolve(proceed);});
    });
    if(!released)return route.abort('timedout');
   }
   if(entry)submissionEvent(entry,'sent_to_local_server');
   return route.continue();
  }
 }catch{}
 blockedRequests.push({sequence:blockedRequests.length+1,at:new Date().toISOString(),origin:new URL(route.request().url()).origin,method:route.request().method()});
 return route.abort('blockedbyclient');
});
let page=await context.newPage();page.setDefaultTimeout(10000);let calls=0,shots=0;
const errors=[];const observe=target=>{target.on('pageerror',error=>errors.push(error.message.slice(0,1000)));target.on('dialog',dialog=>dialog.dismiss());};observe(page);
await page.goto(new URL('/console',settings.url).href,{waitUntil:'domcontentloaded'});
const snapshot=async()=>({url:page.url(),snapshot:(await page.locator('body').ariaSnapshot()).slice(0,22000),pageErrors:errors.slice(-5),navigationAttempts:navigationAttempts.slice(-20),submissions:submissions.slice(-10),pasteReceipts:pastes.slice(-8),blockedRequests:blockedRequests.slice(-8),toolVersion:qaToolVersion,capabilities:qaCapabilities,permittedFixtures:settings.fixtureModes||[],imagePasteAllowed:settings.imagePasteAllowed===true,
 editor:await page.locator('.wt-markdown-editor').evaluateAll(roots=>roots.map(root=>({content:root.querySelector('input[name="markdownContent"]')?.value||root.querySelector('.cm-content')?.textContent||'',images:[...root.querySelectorAll('img')].map(img=>({alt:img.alt,source:img.getAttribute('src'),loaded:img.complete&&img.naturalWidth>0,width:img.naturalWidth,height:img.naturalHeight})),pastedImages:[...root.querySelectorAll('input[type="file"][name="pastedImages"]')].flatMap(input=>[...(input.files||[])].map(file=>({name:file.name,type:file.type,size:file.size}))),imageSources:[...root.querySelectorAll('input[name="pastedImageSources"]')].map(input=>input.value)})))});
const server=new McpServer({name:'worktrace-local-browser',version:'1.0.0'});
server.registerTool('browser_action',{description:'Local synthetic WorkTrace UI only. Use exact role/name from a snapshot. paste dispatches synthetic text/plain. paste_image pastes a fixed generated PNG through the real image handler if approved; no host files or system clipboard. Every response includes pasteReceipts, submissions for feedback AND work-log POSTs, committed navigationAttempts, editor image/file metadata, capabilities and permittedFixtures. log_save_error_on/off aborts a local log save before reaching the server; use it to verify failure recovery. This proves simulated request failure, not a database outage. snapshot returns all current receipts. External navigation is blocked. test_account switches member/memberB. No caller scripts, shell, credentials, admin or remote access.',inputSchema:{action:z.enum(['snapshot','navigate','click','fill','paste','paste_image','select','press','reload','reopen','screenshot','test_account','test_fixture']),role:z.enum(['textbox','button','link','combobox','checkbox']).optional(),name:z.string().max(300).optional(),index:z.number().int().min(0).max(10).optional(),value:z.string().max(6000).optional(),url:z.string().max(300).optional()}},async args=>{
 if(++calls>210)throw Error('Browser action budget reached.');
 const item={at:new Date().toISOString(),...args};
 try{
  if(['click','fill','paste','paste_image','select','press'].includes(args.action)){
   if(!args.role||!args.name)throw Error('Use a role and name from a fresh snapshot.');
   if(/删除|吊销|成员管理|权限|账户|退出|授权|delete|revoke|permission|account|sign out/i.test(args.name))throw Error('This action is outside the local experience scope.');
   let target=page.getByRole(args.role,{name:args.name,exact:true});if(args.index!==undefined)target=target.nth(args.index);
   if(settings.testFixtures===true&&settings.maySubmitFeedback===false&&new URL(page.url()).pathname==='/console/feedback'&&['click','press'].includes(args.action)&&args.role==='button')throw Error('Feedback submission is outside this ticket test plan. Record unrelated findings separately.');
   if(args.action==='click')await target.click();
   if(args.action==='fill')await target.fill(args.value??'');
   if(args.action==='paste'){
    if(args.role!=='textbox')throw Error('Paste is restricted to a local textbox.');
    await target.focus();
    item.paste=await target.evaluate((element,text)=>{const data=new DataTransfer();data.setData('text/plain',text);const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});element.dispatchEvent(event);return {method:'synthetic_browser_paste_event',trusted:event.isTrusted,handled:event.defaultPrevented,textLength:text.length};},args.value??'');
   }
   if(args.action==='paste_image'){
    if(args.role!=='textbox'||settings.testFixtures!==true||settings.imagePasteAllowed!==true)throw Error('Synthetic image paste is not in this ticket test plan.');
    await target.focus();
    item.paste=await target.evaluate(element=>{
     const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;
     const context=canvas.getContext('2d');context.fillStyle='#087e86';context.fillRect(0,0,96,64);context.fillStyle='#d4f1ed';context.fillRect(12,12,72,40);
     const binary=atob(canvas.toDataURL('image/png').split(',')[1]);const file=new File([Uint8Array.from(binary,char=>char.charCodeAt(0))],'rsi-synthetic-image.png',{type:'image/png'});
     const data=new DataTransfer();data.items.add(file);const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});element.dispatchEvent(event);
     return {method:'synthetic_browser_image_paste_event',trusted:event.isTrusted,handled:event.defaultPrevented,name:file.name,type:file.type,bytes:file.size,width:canvas.width,height:canvas.height};
    });
   }
   if(item.paste){const receipt={sequence:pastes.length+1,at:new Date().toISOString(),...item.paste};pastes.push(receipt);appendFileSync(path.join(settings.evidenceDir,'pastes.jsonl'),JSON.stringify(receipt)+'\n');}
   if(args.action==='select')await target.selectOption(args.value??'');
   if(args.action==='press'){if(!['Enter','Tab','Escape','ArrowDown','ArrowUp','Control+Enter','Control+A','Backspace'].includes(args.value))throw Error('Unsupported key.');await target.press(args.value);}
  }
  if(args.action==='navigate'){
   const url=new URL(args.url||'',origin);if(url.origin!==origin||!/^\/(?:console(?:\/(?:logs(?:\/[^?#]*)?|my-logs|feedback))?)?\/?$/.test(url.pathname))throw Error('Navigation outside local product scope.');
   await page.goto(url.href,{waitUntil:'domcontentloaded'});
  }
  if(args.action==='reload')await page.reload({waitUntil:'domcontentloaded'});
  if(args.action==='reopen'){const url=page.url();await page.close();page=await context.newPage();page.setDefaultTimeout(10000);observe(page);await page.goto(url,{waitUntil:'domcontentloaded'});}
  if(args.action==='test_account'){if(!['member','memberB'].includes(args.value))throw Error('Only synthetic ordinary members are available.');await context.addCookies([{name:fixtureCookieName(Number(new URL(origin).port)),value:args.value,url:origin,httpOnly:true,sameSite:'Strict'}]);await page.reload({waitUntil:'domcontentloaded'});}
  if(args.action==='test_fixture'){if(settings.testFixtures!==true)throw Error('Failure fixtures are available only in the isolated QA stage.');if(!settings.fixtureModes?.includes(args.value))throw Error('This fixture is not in the approved ticket test plan. Do not mark the product failed or expand scope.');item.fixture=await applyFixture({context,page,origin,mode:args.value,setPostFailure:value=>{failPosts=value;},setLogSaveFailure:value=>{failLogSaves=value;},setSubmissionHold});}
  if(args.action==='screenshot'){
   if(++shots>30)throw Error('Screenshot budget reached.');
   const name=`screenshot-${String(shots).padStart(2,'0')}.png`,image=await page.screenshot({fullPage:false});writeFileSync(path.join(settings.evidenceDir,name),image);item.evidence=name;appendFileSync(path.join(settings.evidenceDir,'trace.jsonl'),JSON.stringify(item)+'\n');
   return {content:[{type:'text',text:JSON.stringify({file:name,...await snapshot()})},{type:'image',mimeType:'image/png',data:image.toString('base64')}]};
  }
  const current=await snapshot();item.url=current.url;item.navigationAttempts=current.navigationAttempts;appendFileSync(path.join(settings.evidenceDir,'trace.jsonl'),JSON.stringify(item)+'\n');
  return {content:[{type:'text',text:JSON.stringify(current)}]};
 }catch(error){item.error=error.message;appendFileSync(path.join(settings.evidenceDir,'trace.jsonl'),JSON.stringify(item)+'\n');return {isError:true,content:[{type:'text',text:error.message}]};}
});
async function close(){holdSubmissions=false;for(const release of pendingSubmissions.values())release(false);pendingSubmissions.clear();await browser.close();process.exit(0);}process.on('SIGINT',close);process.on('SIGTERM',close);process.stdin.on('end',close);
await server.connect(new StdioServerTransport());
