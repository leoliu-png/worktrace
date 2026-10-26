// Product runtime browser for unattended local agents; never attaches to a person's browser profile.
import {readFileSync,mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {installStorageFailure,applyFixture} from '../lib/browser-fixtures.mjs';
import {fixtureCookieName} from '../lib/local-login.mjs';
const settings=JSON.parse(readFileSync(process.argv[2],'utf8'));
const origin=new URL(settings.url).origin;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Only the configured local app is allowed.');
mkdirSync(settings.evidenceDir,{recursive:true});
const browser=await chromium.launch({headless:true,...(settings.channel&&settings.channel!=='chromium'?{channel:settings.channel}:{})});
const context=await browser.newContext({viewport:{width:1360,height:960},locale:'zh-CN'});
await context.addInitScript(installStorageFailure);let failPosts=false;
const navigationAttempts=[];
function navigationAttempt(value){
 const entry={sequence:navigationAttempts.length+1,at:new Date().toISOString(),...value};
 navigationAttempts.push(entry);appendFileSync(path.join(settings.evidenceDir,'navigation.jsonl'),JSON.stringify(entry)+'\n');
}
await context.exposeBinding('__rsiRecordWindowOpen',(source,value)=>{
 try{if(new URL(source.frame.url()).origin!==origin||typeof value?.url!=='string')return;const target=new URL(value.url,source.frame.url());navigationAttempt({method:'window.open',url:target.href.slice(0,2000),sourceUrl:source.frame.url(),external:target.origin!==origin,phase:'requested'});}catch{}
});
// Fixed instrumentation records the application's real window.open call, without granting caller scripts.
await context.addInitScript(()=>{
 const original=window.open;
 window.open=function(url,target,features){
  try{void window.__rsiRecordWindowOpen({url:String(url??'')}).catch(()=>{});}catch{}
  return original.call(window,url,target,features);
 };
});
await context.route('**/*',route=>{
 try{
  const request=route.request(),url=new URL(request.url()),navigation=request.isNavigationRequest();
  const navigationAllowed=!navigation||/^\/(?:console(?:\/(?:logs(?:\/[^?#]*)?|my-logs|feedback))?)?\/?$/.test(url.pathname);
  const allowed=url.origin===origin&&navigationAllowed&&!url.pathname.startsWith('/console/admin')&&!url.pathname.startsWith('/_rsi/');
  if(navigation)navigationAttempt({method:'navigation',url:url.href.slice(0,2000),blocked:!allowed,external:url.origin!==origin,phase:allowed?'allowed_local':'blocked_by_local_policy'});
  if(allowed){if(settings.testFixtures===true&&settings.maySubmitFeedback===false&&request.method()==='POST'&&url.pathname==='/console/feedback')return route.abort('blockedbyclient');if(failPosts&&request.method()==='POST'&&url.pathname==='/console/feedback')return route.fulfill({status:503,contentType:'text/plain',body:'Synthetic local service failure'});return route.continue();}
 }catch{}
 return route.abort('blockedbyclient');
});
let page=await context.newPage();page.setDefaultTimeout(10000);let calls=0,shots=0;
const errors=[];const observe=target=>{target.on('pageerror',error=>errors.push(error.message.slice(0,1000)));target.on('dialog',dialog=>dialog.dismiss());};observe(page);
await page.goto(new URL('/console',settings.url).href,{waitUntil:'domcontentloaded'});
const snapshot=async()=>({url:page.url(),snapshot:(await page.locator('body').ariaSnapshot()).slice(0,22000),pageErrors:errors.slice(-5),navigationAttempts:navigationAttempts.slice(-20)});
const server=new McpServer({name:'worktrace-local-browser',version:'1.0.0'});
server.registerTool('browser_action',{description:'Interact with the synthetic local WorkTrace UI only. First snapshot, then target exact roles/names. paste dispatches a fixed text/plain ClipboardEvent with value to the focused textbox, exercising the actual editor paste handler without reading or changing the OS clipboard. Its receipt states that this is a synthetic browser paste event. Responses include navigationAttempts from actual window.open calls and intercepted navigation requests; external requests are blocked and never loaded. Use these receipts to verify exact link destinations. reopen reopens the current tab. test_account switches synthetic members (member/memberB). QA fixtures are limited to the current approved test plan; a rejected fixture means outside this task, not a product failure. No caller scripts, shell, source reads, real accounts, admin access or remote pages.',inputSchema:{action:z.enum(['snapshot','navigate','click','fill','paste','select','press','reload','reopen','screenshot','test_account','test_fixture']),role:z.enum(['textbox','button','link','combobox','checkbox']).optional(),name:z.string().max(300).optional(),index:z.number().int().min(0).max(10).optional(),value:z.string().max(6000).optional(),url:z.string().max(300).optional()}},async args=>{
 if(++calls>140)throw Error('Browser action budget reached.');
 const item={at:new Date().toISOString(),...args};
 try{
  if(['click','fill','paste','select','press'].includes(args.action)){
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
  if(args.action==='test_fixture'){if(settings.testFixtures!==true)throw Error('Failure fixtures are available only in the isolated QA stage.');if(!settings.fixtureModes?.includes(args.value))throw Error('This fixture is not in the approved ticket test plan. Do not mark the product failed or expand scope.');item.fixture=await applyFixture({context,page,origin,mode:args.value,setPostFailure:value=>{failPosts=value;}});}
  if(args.action==='screenshot'){
   if(++shots>14)throw Error('Screenshot budget reached.');
   const name=`screenshot-${String(shots).padStart(2,'0')}.png`,image=await page.screenshot({fullPage:false});writeFileSync(path.join(settings.evidenceDir,name),image);item.evidence=name;appendFileSync(path.join(settings.evidenceDir,'trace.jsonl'),JSON.stringify(item)+'\n');
   return {content:[{type:'text',text:JSON.stringify({file:name,...await snapshot()})},{type:'image',mimeType:'image/png',data:image.toString('base64')}]};
  }
  const current=await snapshot();item.url=current.url;item.navigationAttempts=current.navigationAttempts;appendFileSync(path.join(settings.evidenceDir,'trace.jsonl'),JSON.stringify(item)+'\n');
  return {content:[{type:'text',text:JSON.stringify(current)}]};
 }catch(error){item.error=error.message;appendFileSync(path.join(settings.evidenceDir,'trace.jsonl'),JSON.stringify(item)+'\n');return {isError:true,content:[{type:'text',text:error.message}]};}
});
async function close(){await browser.close();process.exit(0);}process.on('SIGINT',close);process.on('SIGTERM',close);process.stdin.on('end',close);
await server.connect(new StdioServerTransport());
