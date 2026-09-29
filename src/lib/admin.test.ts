import { describe, expect, it } from 'vitest';
import { requireAdministrator } from './admin';

describe('administrator authorization', () => {
  it('rejects member accounts before an admin operation starts', () => {
    expect(() => requireAdministrator({ role: 'MEMBER' })).toThrow('Administrator access is required');
    expect(requireAdministrator({ role: 'ADMIN' })).toBeUndefined();
  });
});
