import 'server-only';
export async function rsiControl(path: string, body?: unknown) {
  const endpoint = process.env.RSI_CONTROL_URL;
  const token = process.env.RSI_CONTROL_TOKEN;
  if (!endpoint || !token) throw new Error('自动优化服务尚未配置。');
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/') throw new Error('本地服务地址不合法。');
  const response = await fetch(new URL(path, url), { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '自动优化服务暂不可用。');
  return result;
}
