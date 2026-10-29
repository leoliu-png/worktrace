import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserNavigationAllowed} from '../lib/browser-policy.mjs';

const origin='http://127.0.0.1:3040';
const allowed=(path,method)=>browserNavigationAllowed(new URL(path,origin),origin,method);
test('only local synthetic member accounts are available for agent login',()=>{
 for(const path of ['/_rsi/login','/_rsi/login/member?explicit=1','/_rsi/login/member-b?explicit=1&next=%2Fconsole%2Ffeedback','/console/my-logs'])assert.equal(allowed(path),true,path);
 for(const path of ['/_rsi/login/admin-a?explicit=1','/_rsi/login/admin-b','/_rsi/acceptance','/_rsi/login/member?next=%2Fconsole%2Fadmin%2Frsi','/console/admin/rsi','https://example.com/console'])assert.equal(allowed(path),false,path);
 assert.equal(allowed('/_rsi/login/member?explicit=1','POST'),false);
 assert.equal(allowed('/_rsi/login/member?unknown=1'),false);
});
