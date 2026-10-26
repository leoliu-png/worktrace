export function installStorageFailure(){
 try{if(document.cookie.split(';').some(part=>part.trim()==='rsi-test-storage=off'))for(const name of ['getItem','setItem','removeItem'])Object.defineProperty(Storage.prototype,name,{configurable:true,value(){throw new DOMException('Synthetic local storage failure','SecurityError');}});}catch{}
}
export function corruptFeedbackDrafts(){const keys=Object.keys(localStorage).filter(key=>/worktrace/i.test(key)&&/feedback/i.test(key)&&/draft/i.test(key));for(const key of keys)localStorage.setItem(key,'{invalid-json');return keys;}
export const fixtureModes=['storage_off','storage_on','corrupt_drafts','server_error_on','server_error_off'];
export async function applyFixture({context,page,origin,mode,setPostFailure}){
 if(!fixtureModes.includes(mode))throw Error('Unsupported test fixture.');
 if(mode.startsWith('server_error')){setPostFailure(mode==='server_error_on');return {mode};}
 if(mode==='corrupt_drafts'){const keys=await page.evaluate(corruptFeedbackDrafts);if(!keys.length)throw Error('Create a synthetic feedback draft before corrupting it.');await page.reload({waitUntil:'domcontentloaded'});return {mode,keys};}
 await context.addCookies([{name:'rsi-test-storage',value:mode==='storage_off'?'off':'on',url:origin,httpOnly:false,sameSite:'Strict'}]);await page.reload({waitUntil:'domcontentloaded'});return {mode};
}
