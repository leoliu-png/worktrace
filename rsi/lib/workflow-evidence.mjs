import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
export const imageSpacingRequired=task=>/图片|image/i.test(task.description)&&/空白|换行|间距|spacing|blank.line/i.test(task.description);
export function reproductionEvidence(task,answer){
 const directory=answer._rsiEvidenceDir;let probe=null,screenshots=[];
 try{screenshots=readdirSync(directory).filter(x=>x.endsWith('.png'));}catch{}
 try{probe=JSON.parse(readFileSync(path.join(directory,'image-spacing.json'),'utf8'));}catch{}
 const valid=['REPRODUCED','FEATURE'].includes(answer.outcome)&&!!answer.rootCause?.trim()&&!!answer.evidence?.length&&screenshots.length>0&&(!imageSpacingRequired(task)||probe?.passed===false);
 return {valid,probe,screenshots};
}
export function enforceVisualEvidence(task,qa){
 if(!imageSpacingRequired(task))return qa;
 let probe;try{probe=JSON.parse(readFileSync(path.join(qa._rsiEvidenceDir,'image-spacing.json'),'utf8'));}catch{}
 if(!probe)return {...qa,passed:false,failureKind:'tooling',summary:'未提供图片上方真实占位高度的测量证据，需真人验收。',checks:[{name:'原始可见空白行',passed:false,evidence:'缺少 image-spacing.json'}]};
 if(!probe.passed)return {...qa,passed:false,failureKind:'product',summary:'实际图片间距探针仍检测到空白行或图片插入失败。',checks:probe.checks.map(x=>({name:x.name,passed:x.passed,evidence:JSON.stringify(x)}))};
 return qa;
}
