import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {sourceAccess} from './source-access.mjs';
import {imageSpacingProbe} from './editor-probe.mjs';
import {imageSpacingRequired} from './workflow-evidence.mjs';

// Known regressions use deterministic local probes before paying for model reasoning.
// Other tickets keep the general bounded source/browser diagnosis route.
export async function diagnosticBundle(config,task,root,directory,{forceProbe=false}={}){
 if(!forceProbe&&!imageSpacingRequired(task))return null;
 const origin=new URL(config.appUrl).origin;
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Diagnosis requires a local synthetic app.');
 mkdirSync(directory,{recursive:true});
 const browser=await chromium.launch({headless:true,...(config.browserChannel?{channel:config.browserChannel}:{})});
 const abort=()=>{void browser.close().catch(()=>{});};config.signal?.addEventListener('abort',abort,{once:true});if(config.signal?.aborted)abort();
 let probe;
 try{const context=await browser.newContext({viewport:{width:1360,height:960}});await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());return url.origin===origin&&request.method()==='GET'&&!url.pathname.startsWith('/console/admin')?route.continue():route.abort('blockedbyclient');});const page=await context.newPage();await page.goto(origin+'/console/logs/new',{waitUntil:'domcontentloaded'});await page.locator('.cm-content[contenteditable="true"]').first().waitFor();probe=await imageSpacingProbe(page,directory);}finally{config.signal?.removeEventListener('abort',abort);await browser.close();}
 const source=sourceAccess(root,[]),snippets=[];
 const wanted=[['src/components/markdown-editor.tsx','imageField'],['src/components/markdown-editor.tsx','imagePaste'],['src/app/styles.css','.cm-line'],['src/app/styles.css','image-widget'],['src/lib/markdown-editing.ts','imagePasteInsertion'],['node_modules/codemirror-live-markdown/dist/index.js','function buildImageDecorations']];
 for(const [file,query]of wanted){try{const search=source.read(file,{query});for(const hit of search.hits.slice(0,2))snippets.push(source.read(file,{startLine:Math.max(1,hit.line-5),endLine:hit.line+32}));}catch{}}
 const bundle={kind:'image_spacing',probe,sourceSnippets:snippets,evidenceDir:directory,observation:'The fixed probe measures rendered whitespace height, not just Markdown. Use supplied snippets before requesting extra context.'};
 writeFileSync(path.join(directory,'diagnostic-bundle.json'),JSON.stringify(bundle,null,2));return bundle;
}
