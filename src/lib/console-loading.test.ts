import { describe, expect, it } from 'vitest';
import { consoleLoadingMessage, pendingNavigationClass } from './console-loading';

describe('console loading messages', () => {
  it('names the destination page while it is loading', () => {
    expect(consoleLoadingMessage('/console/api-keys')).toBe('正在加载 API 密钥…');
    expect(consoleLoadingMessage('/console/logs')).toBe('正在加载全部日志…');
  });

  it('marks the clicked destination active before its content arrives', () => {
    expect(pendingNavigationClass('', '/console/api-keys', '/console/api-keys')).toBe('active');
    expect(pendingNavigationClass('active', '/console/api-keys', '/console/logs')).toBe('');
    expect(pendingNavigationClass('stitch-new-log', '/console/api-keys', '/console/logs/new')).toBe('stitch-new-log');
  });
});
