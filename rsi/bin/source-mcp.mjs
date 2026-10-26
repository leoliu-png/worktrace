// The developer can read product source and write approved files, with no host shell.
import {readFileSync,appendFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {sourceAccess} from '../lib/source-access.mjs';
const settings=JSON.parse(readFileSync(process.argv[2],'utf8')),access=sourceAccess(settings.root,settings.scope);
mkdirSync(settings.directory,{recursive:true});let count=0;
const server=new McpServer({name:'worktrace-scoped-source',version:'1.0.0'});
server.registerTool('source_action',{description:'Scoped task source access. list returns allowed product files; read returns content plus sha256; write replaces one approved source file only and must supply the exact sha256 from read, or null for a new file. No shell, dependency changes, deletes, secrets, auth, database or runtime files.',inputSchema:{action:z.enum(['list','read','write']),file:z.string().max(300).optional(),content:z.string().max(100000).optional(),expectedHash:z.string().length(64).nullable().optional()}},async args=>{
 const event={at:new Date().toISOString(),action:args.action,file:args.file};try{if(++count>140)throw Error('Source action budget reached.');const result=args.action==='list'?{files:access.list(),writeScope:settings.scope}:args.action==='read'?access.read(args.file):access.write(args.file,args.content,args.expectedHash);appendFileSync(path.join(settings.directory,'source-trace.jsonl'),JSON.stringify({...event,ok:true})+'\n');return {content:[{type:'text',text:JSON.stringify(result)}]};}catch(error){appendFileSync(path.join(settings.directory,'source-trace.jsonl'),JSON.stringify({...event,error:error.message})+'\n');return {isError:true,content:[{type:'text',text:error.message}]};}
});
await server.connect(new StdioServerTransport());
