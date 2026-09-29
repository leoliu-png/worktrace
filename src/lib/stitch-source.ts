import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const screenFiles = {
  home: 'home.html',
  overview: 'overview.html',
  'work-logs': 'work-logs.html',
  'new-log': 'new-log.html',
  'api-keys': 'api-keys.html',
  'my-logs': 'my-logs.html',
} as const;

export type StitchScreen = keyof typeof screenFiles;
export type StitchRuntimeOptions = {
  role?: 'ADMIN' | 'MEMBER';
  image?: string | null;
};

const sidebarRoutes = [
  ['dashboard', '/console'],
  ['list_alt', '/console/logs'],
  ['person_search', '/console/my-logs'],
  ['history_edu', '/console/my-logs'],
  ['vpn_key', '/console/api-keys'],
  ['group', '/console/admin/members'],
  ['admin_panel_settings', '/console/admin/access'],
  ['settings_suggest', '/console/admin/logs'],
  ['security', '/console/admin/audit'],
] as const;

function bindSidebarRoute(html: string, icon: string, route: string): string {
  const pattern = new RegExp(
    `(<a\\b[^>]*?)href="#"([^>]*>\\s*<span[^>]*>\\s*${icon}\\s*<\\/span>)`,
  );
  return html.replace(pattern, `$1href="${route}" target="_top"$2`);
}

function bindConsoleInteractions(html: string): string {
  let result = html;

  for (const [icon, route] of sidebarRoutes) {
    result = bindSidebarRoute(result, icon, route);
  }

  result = result.replace(
    /(<button\b[^>]*)(>\s*<span[^>]*>add<\/span>\s*新建日志<\/button>)/,
    '$1 onclick="window.top.location.href=\'/console/logs/new\'"$2',
  );
  result = result.replace(
    /(<button\b[^>]*)(>查看全部<\/button>)/,
    '$1 onclick="window.top.location.href=\'/console/logs\'"$2',
  );

  return result;
}

function addAdministratorNavigation(html: string, role?: StitchRuntimeOptions['role']): string {
  if (role !== 'ADMIN') {
    return html
      .replace(/<li[^>]*>\s*<a\b[^>]*href="\/console\/admin\/[^\"]+"[^>]*>[\s\S]*?<\/a>\s*<\/li>/g, '')
      .replace(/<a\b[^>]*href="\/console\/admin\/[^\"]+"[^>]*>[\s\S]*?<\/a>/g, '');
  }
  if (html.includes('/console/admin/members')) return html;

  const itemClass = 'flex items-center gap-md px-lg py-sm text-on-surface-variant hover:bg-surface-container-high transition-colors font-body-sm text-body-sm';
  const adminItems = `
<li><a class="${itemClass}" href="/console/admin/members" target="_top"><span class="material-symbols-outlined">group</span>成员管理</a></li>
<li><a class="${itemClass}" href="/console/admin/access" target="_top"><span class="material-symbols-outlined">admin_panel_settings</span>权限控制</a></li>
<li><a class="${itemClass}" href="/console/admin/logs" target="_top"><span class="material-symbols-outlined">settings_suggest</span>日志管理</a></li>
<li><a class="${itemClass}" href="/console/admin/audit" target="_top"><span class="material-symbols-outlined">security</span>安全审计</a></li>`;

  return html.replace(/<\/ul>\s*<\/nav>\s*<\/aside>/, `${adminItems}\n</ul>\n</nav>\n</aside>`);
}

function addRuntimeBridge(html: string, options: StitchRuntimeOptions): string {
  const image = JSON.stringify(options.image ?? '');
  const script = `<script>
(() => {
  const workTraceImage = ${image};
  document.querySelectorAll('img[alt="User Avatar"], img[alt="Administrator"]').forEach((imageElement) => {
    if (workTraceImage) imageElement.src = workTraceImage;
    const trigger = imageElement.closest('button, div');
    if (trigger) trigger.addEventListener('click', () => window.parent.postMessage({ type: 'WORKTRACE_ACCOUNT_MENU' }, window.location.origin));
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const label = button.textContent.trim();
    if (label.includes('新建日志')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.top.location.href = '/console/logs/new';
      return;
    }
    if (label !== '保存日志') return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const title = document.querySelector('input[placeholder*="一句话"]')?.value.trim();
    const completedText = document.querySelector('textarea[placeholder*="详细描述"]')?.value.trim();
    if (!title || !completedText) {
      window.alert('请填写标题和完成事项。');
      return;
    }
    button.disabled = true;
    button.textContent = '保存中...';
    const response = await fetch('/api/v1/work-logs', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, completed: completedText.split('\\n').map((item) => item.trim()).filter(Boolean) }),
    });
    if (!response.ok) {
      button.disabled = false;
      button.textContent = '保存日志';
      window.alert('保存失败，请稍后重试。');
      return;
    }
    window.top.location.href = '/console/my-logs';
  }, true);
})();
</script>`;
  return html.replace('</body>', `${script}</body>`);
}

export function readStitchScreen(screen: StitchScreen, options: StitchRuntimeOptions = {}): string {
  const html = readFileSync(join(process.cwd(), 'stitch-worktrace', 'html', screenFiles[screen]), 'utf8');
  if (screen !== 'home') {
    const brandedHtml = html.replace(
      /<div>\s*<h1 class="font-headline-md text-headline-md text-primary">工作台<\/h1>\s*<p class="font-body-sm text-body-sm text-on-surface-variant">企业级轨迹追踪<\/p>\s*<\/div>/,
      '<div><a href="/" target="_top" class="font-headline-md text-headline-md text-primary">WorkTrace</a></div>',
    );
    return addRuntimeBridge(addAdministratorNavigation(bindConsoleInteractions(brandedHtml), options.role), options);
  }
  return html;
}
