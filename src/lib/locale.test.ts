import { describe, expect, it } from 'vitest';
import { translate } from './locale';

describe('interface translations', () => {
  it('provides English system labels without translating user content', () => {
    expect(translate('en', 'console')).toBe('Console');
    expect(translate('en', 'newLog')).toBe('New log');
    expect(translate('zh', 'newLog')).toBe('新建日志');
  });
});
