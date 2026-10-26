// Used only by the loopback RSI test proxy, never by the production application.
const accounts={
 'admin-a':{role:'adminA',label:'管理员 A',description:'查看自动优化、处理任务及人工验收',destination:'/console/admin/rsi'},
 'admin-b':{role:'adminB',label:'管理员 B',description:'供第二名验收人独立检查和确认',destination:'/console/admin/rsi'},
 member:{role:'member',label:'普通成员',description:'编写日志和提交建议反馈',destination:'/console'},
 'member-b':{role:'memberB',label:'普通成员 B',description:'检查成员权限和账号之间的数据隔离',destination:'/console'},
};
export function fixtureCookieName(port){if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local fixture port.');return `rsi-fixture-${port}`;}
export function fixtureRole(header,port){const name=fixtureCookieName(port);const value=(header||'').split(';').map(item=>item.trim()).find(item=>item.startsWith(name+'='))?.slice(name.length+1);return ['adminA','adminB','memberB'].includes(value)?value:'member';}
function cookie(port,value){return `${fixtureCookieName(port)}=${value}; Path=/; HttpOnly; SameSite=Strict`;}
function loginPage(){return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地验收登录 · WorkTrace</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f7f7;color:#142f3c;font:16px/1.65 system-ui,"Microsoft YaHei",sans-serif}main{max-width:800px;margin:8vh auto;padding:32px}.brand{color:#087e86;font-weight:700;font-size:22px}.panel{margin-top:28px;background:white;border:1px solid #cfdddd;border-radius:14px;padding:32px}h1{font-size:28px;margin:0 0 12px}p{color:#526b75;margin:8px 0 24px}.badge{display:inline-block;margin-bottom:14px;padding:3px 10px;border-radius:6px;background:#e5f2f0;color:#086c70;font-size:13px}.accounts{display:grid;grid-template-columns:1fr 1fr;gap:16px}a{display:block;padding:18px;border:1px solid #bbd3d3;border-radius:8px;color:#096a75;text-decoration:none}a:hover,a:focus-visible{border-color:#087e86;background:#f0f8f7;outline:2px solid #087e86;outline-offset:2px}a strong{display:block;font-size:18px}a span{display:block;margin-top:5px;color:#60747c;font-size:13px}.note{margin:24px 0 0;font-size:13px}@media(max-width:600px){main{margin:24px auto;padding:18px}.panel{padding:22px}.accounts{grid-template-columns:1fr}}
</style></head><body><main><div class="brand">WorkTrace</div><section class="panel"><div class="badge">仅本地验收 · 合成测试数据</div><h1>选择测试账号登录</h1><p>请选择下列账号进入本地测试环境，无需 Google 授权。</p><div class="accounts">${Object.entries(accounts).map(([key,account])=>`<a href="/_rsi/login/${key}"><strong>${account.label}</strong><span>${account.description}</span></a>`).join('')}</div><p class="note">正式环境继续使用公司的 Google 登录。本页只在本地验收服务中提供；管理控制台与测试版分别保存账号选择。</p></section></main></body></html>`;}
export function localLoginResponse(requestUrl,method,port){
 const url=new URL(requestUrl,`http://127.0.0.1:${port}`),pathname=url.pathname;
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 const redirect=(location,extra={})=>({status:303,headers:{...headers,Location:location,...extra},body:''});
 if(pathname==='/'||/^\/api\/auth\/(?:signin(?:\/.*)?|callback\/google|error)\/?$/.test(pathname))return redirect('/_rsi/login');
 if(/^\/api\/auth\/signout\/?$/.test(pathname))return redirect('/_rsi/login',{'Set-Cookie':cookie(port,'')+'; Max-Age=0'});
 if(/^\/_rsi\/login\/?$/.test(pathname))return {status:200,headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"},body:method==='HEAD'?'':loginPage()};
 const selected=/^\/_rsi\/login\/([^/]+)\/?$/.exec(pathname);
 if(selected){const name=selected[1];if(!Object.hasOwn(accounts,name))return redirect('/_rsi/login');const account=accounts[name];return redirect(account.destination,{'Set-Cookie':cookie(port,account.role)});}
 return null;
}
