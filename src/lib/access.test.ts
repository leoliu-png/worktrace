import { describe, expect, it } from 'vitest';
import { isAdminEmail, visibleNavigation } from './access';

describe('WorkTrace role policy', () => {
  it('bootstraps Linden as the only initial administrator', () => {
    expect(isAdminEmail('linden@feedmob.com')).toBe(true);
    expect(isAdminEmail('rachel.lu@feedmob.com')).toBe(false);
  });

  it('does not expose management pages to members', () => {
    expect(visibleNavigation('MEMBER').map((item) => item.id)).not.toContain('members');
    expect(visibleNavigation('ADMIN').map((item) => item.id)).toEqual(expect.arrayContaining(['members', 'access', 'admin-logs', 'audit']));
  });
});
