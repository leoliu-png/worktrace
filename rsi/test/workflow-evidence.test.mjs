import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {enforceVisualEvidence,reproductionEvidence} from '../lib/workflow-evidence.mjs';
import {diagnosticBundle} from '../lib/diagnostic-bundle.mjs';
import {qaPlan} from '../lib/task-memory.mjs';

test('model claims and green string tests cannot override measured visual failures',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'rsi-evidence-'));
 try{
  const task={description:'图片上方有空白行'},qa={passed:true,failureKind:'none',summary:'all green',checks:[],_rsiEvidenceDir:directory};
  assert.equal(enforceVisualEvidence(task,qa).failureKind,'tooling');
  writeFileSync(path.join(directory,'image-spacing.json'),JSON.stringify({passed:false,checks:[{name:'indented line',passed:false,placeholderHeight:28.8}]}));
  assert.equal(enforceVisualEvidence(task,qa).failureKind,'product');
  assert.equal(enforceVisualEvidence(task,qa).passed,false);
  writeFileSync(path.join(directory,'image-spacing.json'),JSON.stringify({passed:true,checks:[]}));
  const answer={outcome:'REPRODUCED',rootCause:'guess',evidence:['screenshot'],_rsiEvidenceDir:directory};
  writeFileSync(path.join(directory,'spacing.png'),'synthetic test evidence');
  assert.equal(reproductionEvidence(task,answer).valid,false);
  writeFileSync(path.join(directory,'image-spacing.json'),JSON.stringify({passed:false,checks:[]}));
  assert.equal(reproductionEvidence(task,answer).valid,true);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('a review requirement can request the spacing probe even if the original description lacks spacing keywords',async()=>{
 const task={title:'日志编辑模块优化建议',description:'列表图片缩进对齐',metadata:{scopeFiles:['src/components/markdown-editor.tsx'],acceptance:['保留原有段落空行'],review:{validationRequests:['image_spacing_probe']}}};
 assert.ok(qaPlan(task).requiredCapabilities.includes('image_spacing_probe'));
 const config={appUrl:'https://not-local.example'};
 assert.equal(await diagnosticBundle(config,task,'unused','unused'),null);
 await assert.rejects(()=>diagnosticBundle(config,task,'unused','unused',{forceProbe:true}),/local synthetic app/);
});
