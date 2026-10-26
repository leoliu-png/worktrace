const original=globalThis.fetch;
globalThis.fetch=async function(input,init){const url=new URL(input instanceof Request?input.url:input);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Local RSI environment blocks external application requests.');return original(input,init);};
