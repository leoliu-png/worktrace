// Navigation for an RSI agent is restricted to the local product and the two
// synthetic ordinary-member login routes. Human administrator routes stay out.
export function browserNavigationAllowed(url,origin,method='GET'){
 if(url.origin!==origin)return false;
 if(/^\/(?:console(?:\/(?:logs(?:\/[^?#]*)?|my-logs|feedback))?)?\/?$/.test(url.pathname))return true;
 if(method!=='GET')return false;
 if(/^\/_rsi\/login\/?$/.test(url.pathname))return !url.search;
 if(!/^\/_rsi\/login\/(?:member|member-b)\/?$/.test(url.pathname))return false;
 for(const [key,value] of url.searchParams){
  if(key==='explicit'&&value==='1')continue;
  if(key==='next'&&['/console','/console/feedback'].includes(value))continue;
  return false;
 }
 return true;
}
