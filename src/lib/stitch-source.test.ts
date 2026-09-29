import { describe, expect, it } from 'vitest';
import { readStitchScreen } from './stitch-source';

describe('Stitch screen source', () => {
  it('loads the exported home prototype without replacing its design structure', () => {
    const html = readStitchScreen('home');
    expect(html).toContain('WorkTrace / 工作轨迹');
    expect(html).toContain('通过 MCP 接入');
    expect(html).not.toContain('/api/auth/signin/google');
  });

  it('connects the Stitch sidebar to top-level WorkTrace routes', () => {
    const html = readStitchScreen('overview', { role: 'ADMIN' });

    expect(html).toContain('href="/console/logs" target="_top"');
    expect(html).toContain('href="/console/my-logs" target="_top"');
    expect(html).toContain('href="/console/api-keys" target="_top"');
    expect(html).toContain('href="/console/admin/members" target="_top"');
    expect(html).toContain('window.top.location.href=\'/console/logs/new\'');
  });

  it('binds the signed-in user and administrator navigation into the Stitch runtime', () => {
    const html = readStitchScreen('my-logs', {
      role: 'ADMIN',
      image: 'https://example.com/linden.png',
    });

    expect(html).toContain('https://example.com/linden.png');
    expect(html).toContain('WORKTRACE_ACCOUNT_MENU');
    expect(html).toContain('/console/admin/members');
  });

  it('removes administrator navigation from a member Stitch runtime', () => {
    const html = readStitchScreen('overview', { role: 'MEMBER' });

    expect(html).not.toContain('/console/admin/members');
    expect(html).not.toContain('/console/admin/access');
  });

  it('binds saving a new Stitch log to the authenticated work-log endpoint', () => {
    const html = readStitchScreen('new-log');

    expect(html).toContain("fetch('/api/v1/work-logs'");
    expect(html).toContain("window.top.location.href = '/console/my-logs'");
  });
});
