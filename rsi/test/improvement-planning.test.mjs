import {test} from 'node:test';
import assert from 'node:assert/strict';
import {missingSavedScope,automatableScope} from '../lib/scope-policy.mjs';
import {qaPlan,missingQaCapabilities,developerChecklist,qaVerificationKey} from '../lib/task-memory.mjs';
import {qaToolVersion} from '../lib/qa-capabilities.mjs';

test('preserved changes outside a new scope are identified without granting protected paths',()=>{
 const saved=['src/lib/markdown-editing.ts','src/lib/markdown-editing.test.ts','src/components/markdown-editor.tsx'];
 const scope=['src/lib/markdown-editing.ts','src/lib/markdown-editing.test.ts'];
 assert.deepEqual(missingSavedScope(saved,scope),['src/components/markdown-editor.tsx']);
 assert.equal(automatableScope('src/components/markdown-editor.tsx'),true);
 assert.equal(automatableScope('src/lib/db.ts'),false);
 assert.deepEqual(missingSavedScope(['src/lib/db.ts'],['src']),['src/lib/db.ts']);
});

test('text paste does not require image paste and changed verification scope invalidates evidence',()=>{
 const task={title:'粘贴链接',description:'粘贴文本链接并打开',metadata:{scopeFiles:['src/lib/markdown-editing.ts'],acceptance:['粘贴链接后点击']}};
 const plan=qaPlan(task);assert.equal(plan.imagePasteAllowed,false);assert.ok(plan.requiredCapabilities.includes('text_paste'));
 const first=qaVerificationKey('sha1',plan);
 assert.notEqual(first,qaVerificationKey('sha1',{...plan,scopeFiles:['src/components/markdown-editor.tsx']}));
 assert.notEqual(first,qaVerificationKey('sha2',plan));
});

test('QA preflight identifies missing capabilities and only reuses evidence for the same plan and source',()=>{
 const task={title:'日志图片保存失败',description:'粘贴图片后保存失败，重新打开草稿',metadata:{scopeFiles:['src/lib/markdown-editing.ts'],acceptance:['粘贴图片并验证保存失败'],sourceSha:'sha1',verificationKey:'plan1',qaProgress:{sourceSha:'sha1',toolVersion:qaToolVersion,verificationKey:'plan1',checks:[{name:'恢复',passed:true,evidence:'截图'}]}}};
 const plan=qaPlan(task);
 assert.deepEqual(missingQaCapabilities(plan,[]).sort(),['image_paste','log_save_failure','paste_receipts','storage_failure','submission_receipts']);
 assert.deepEqual(missingQaCapabilities(plan),[]);
 assert.equal(plan.previousVerifiedChecks.length,1);
 task.metadata.verificationKey='plan2';assert.deepEqual(qaPlan(task).previousVerifiedChecks,[]);
 task.metadata.verificationKey='plan1';task.metadata.sourceSha='sha2';assert.deepEqual(qaPlan(task).previousVerifiedChecks,[]);
});

test('developer checklist carries approved requirements and earlier findings without adding scope',()=>{
 const task={metadata:{scopeFiles:['src/lib/markdown-editing.ts'],acceptance:['保持列表层级'],failureMemory:[{kind:'review',summary:'嵌套层级丢失',issues:[{file:'src/lib/markdown-editing.ts'}]}]}};
 const result=developerChecklist(task,{stage:'checks',reason:'测试失败'});
 assert.deepEqual(result.acceptance,['保持列表层级']);
 assert.equal(result.historicalFindings[0].summary,'嵌套层级丢失');
 assert.equal(result.latestFindings.stage,'checks');
 assert.deepEqual(task.metadata.scopeFiles,['src/lib/markdown-editing.ts']);
});
