import express from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canAccessAdmin, navigationFor, roleForEmail } from './access-control.mjs';

const app = express();
const root = 'D:/WorkLog';
const prototype = join(root, 'stitch-worktrace', 'html');
const prototypePages = new Map([
  ['/', 'home.html'], ['/console', 'overview.html'], ['/console/logs', 'work-logs.html'],
  ['/console/logs/new', 'new-log.html'], ['/console/api-keys', 'api-keys.html'], ['/console/my-logs', 'my-logs.html'],
]);

const resolveRole = (req) => roleForEmail(String(req.query.as ?? 'linden@feedmob.com'));
const requireAdmin = (req, res, next) => canAccessAdmin(resolveRole(req)) ? next() : res.status(403).json({ code: 'FORBIDDEN', message: 'Administrator access required.' });

app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'worktrace' }));
app.get('/api/v1/me', (req, res) => { const email = String(req.query.as ?? 'linden@feedmob.com'); res.json({ email, role: resolveRole(req) }); });
app.get('/api/v1/navigation', (req, res) => res.json({ role: resolveRole(req), items: navigationFor(resolveRole(req)) }));
app.get('/api/v1/admin/members', requireAdmin, (_req, res) => res.json({ data: [{ email: 'linden@feedmob.com', role: 'admin' }, { email: 'rachel.lu@feedmob.com', role: 'member' }] }));
app.get('/api/v1/admin/access', requireAdmin, (_req, res) => res.json({ allowedDomains: ['feedmob.com'], bootstrapAdmin: 'linden@feedmob.com' }));
app.get('/api/v1/admin/logs', requireAdmin, (_req, res) => res.json({ data: [] }));
app.get('/api/v1/admin/audit', requireAdmin, (_req, res) => res.json({ data: [] }));

function adminPage(title, description, active) {
  const links = navigationFor('admin').map((item) => `<a class="${item.id === active ? 'active' : ''}" href="${item.href}">${item.label}</a>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title} · WorkTrace</title><script src="https://cdn.tailwindcss.com"></script><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"><style>body{font-family:Inter,'Microsoft YaHei',sans-serif;background:#faf8ff;color:#131b2e}.side a{display:block;padding:12px 16px;border-radius:4px;color:#3e4850}.side a.active{background:#e2f7ff;color:#006591;font-weight:700;border-left:3px solid #0ea5e9}</style></head><body><div class="min-h-screen flex"><aside class="side w-64 bg-white border-r border-slate-200 p-6"><a href="/console" class="text-2xl font-bold text-slate-900 mb-9">WORK<span class="font-normal">TRACE</span><span class="text-sky-500">+</span></a><p class="text-xs text-slate-500 mb-3">管理员控制台</p>${links}</aside><main class="flex-1 p-10 max-w-7xl"><p class="text-xs font-bold tracking-widest text-sky-700">ADMINISTRATION</p><h1 class="text-4xl font-bold mt-3">${title}</h1><p class="text-slate-500 mt-3">${description}</p><section class="mt-8 bg-white border border-slate-200 rounded-lg p-6"><div class="flex justify-between border-b border-slate-100 pb-4"><strong>WorkTrace 管理数据</strong><button class="bg-sky-500 text-white px-4 py-2 rounded">管理</button></div><p class="text-slate-500 py-10 text-center">本页将显示对应的管理数据和操作记录。</p></section></main></div></body></html>`;
}

for (const [route, file] of prototypePages) {
  app.get(route, async (req, res) => {
    let html = await readFile(join(prototype, file), 'utf8');
    res.type('html').send(html);
  });
}

app.get('/console/admin/:page', (req, res) => {
  if (!canAccessAdmin(resolveRole(req))) return res.redirect('/console?access=denied');
  const pages = { members: ['成员管理', '管理成员角色和登录状态。'], access: ['权限控制', '维护允许的企业域名和管理员权限。'], logs: ['日志管理', '检索、归档或恢复全局工作日志。'], audit: ['安全审计', '查看登录、角色和敏感操作的审计记录。'] };
  const selected = pages[req.params.page];
  if (!selected) return res.status(404).send('Not found');
  res.type('html').send(adminPage(selected[0], selected[1], req.params.page === 'logs' ? 'admin-logs' : req.params.page));
});
app.listen(5173, () => console.log('WorkTrace is ready at http://localhost:5173'));
