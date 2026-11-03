import {readFileSync} from 'node:fs';
import path from 'node:path';

// Codex reports cached and reasoning tokens inside input/output totals; do not add them twice.
export function parseTokenUsage(log){
 let input=0,output=0,turns=0;
 for(const line of log.split(/\r?\n/)){
  let event;try{event=JSON.parse(line);}catch{continue;}
  if(event.type!=='turn.completed')continue;
  const usage=event.usage;
  if(!usage||!Number.isSafeInteger(usage.input_tokens)||usage.input_tokens<0||!Number.isSafeInteger(usage.output_tokens)||usage.output_tokens<0)return null;
  input+=usage.input_tokens;output+=usage.output_tokens;turns++;
 }
 return turns?{input,output,total:input+output}:null;
}
export function readTokenUsage(directory){
 if(typeof directory!=='string'||!directory)return null;
 try{return parseTokenUsage(readFileSync(path.join(directory,'events.jsonl'),'utf8'));}catch{return null;}
}
