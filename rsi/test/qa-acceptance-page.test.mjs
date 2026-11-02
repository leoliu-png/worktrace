import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localLoginResponse} from '../lib/local-login.mjs';

test('stage acceptance page tells both reviewers which checks remain unverified',()=>{
 const data={title:'编辑日志',sourceSha:'a'.repeat(40),approvedRoles:[],qaDisposition:{status:'unverified',summary:'浏览器工具能力不足',unverifiedChecks:[{name:'多图粘贴',evidence:'工具不支持 <script>'}],blockedCapabilities:['multi_image_paste']}};
 const page=localLoginResponse('/_rsi/acceptance','GET',3042,{stageAcceptance:data});
 assert.equal(page.status,200);assert.match(page.body,/浏览器复测未完成，需真人重点检查/);assert.match(page.body,/多图粘贴/);assert.match(page.body,/&lt;script&gt;/);assert.doesNotMatch(page.body,/<script>/);
});
