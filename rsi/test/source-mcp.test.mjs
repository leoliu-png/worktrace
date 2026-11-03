import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import path from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('real source MCP supports batched reads, exact patching and safe scope expansion without test execution',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'rsi-mcp-test-')),root=path.join(dir,'repo'),project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const client=new Client({name:'local-verification',version:'1.0'});
 try{
  mkdirSync(path.join(root,'src/lib'),{recursive:true});mkdirSync(path.join(dir,'evidence'));
  symlinkSync(path.join(project,'node_modules'),path.join(root,'node_modules'),'junction');
  writeFileSync(path.join(root,'.gitignore'),'node_modules\n');
  writeFileSync(path.join(root,'src/lib/markdown-probe.ts'),'export const value=1;\n');
  writeFileSync(path.join(root,'src/lib/markdown-probe.test.ts'),"import {it,expect} from 'vitest';import {value} from './markdown-probe';it('regression',()=>expect(value).toBe(2));\n");
  const git=args=>execFileSync('git',args,{cwd:root,stdio:'ignore'});git(['init']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture']);
  const settings=path.join(dir,'settings.json');writeFileSync(settings,JSON.stringify({root,scope:[],allowScopeExpansion:true,maxChangedFiles:2,directory:path.join(dir,'evidence')}));
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(project,'rsi/bin/source-mcp.mjs'),settings]}));
  const invoke=async args=>{const r=await client.callTool({name:'source_action',arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
  const [source]=await invoke({action:'read_many',requests:[{file:'src/lib/markdown-probe.ts'}]});
  await invoke({action:'patch',file:source.file,oldText:'value=1',newText:'value=2',expectedHash:source.sha256});
  const listed=await invoke({action:'list'});assert.ok(listed.writeScope.includes(source.file));
  const removed=await client.callTool({name:'source_action',arguments:{action:'check'}});assert.equal(removed.isError,true);
  const denied=await client.callTool({name:'source_action',arguments:{action:'write',file:'src/lib/db.ts',content:'unsafe',expectedHash:null}});assert.equal(denied.isError,true);
 }finally{await client.close();rmSync(dir,{recursive:true,force:true});}
});
