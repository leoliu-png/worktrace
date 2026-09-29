import { describe, expect, it } from 'vitest';
import { resolveSessionUser } from './request-user';

describe('request user resolution', () => {
  it('turns an authenticated Google session into the persisted WorkTrace user', () => {
    const user = { id: 'stored-user', email: 'linden@feedmob.com', name: 'Linden', role: 'ADMIN' as const };
    const database = { findOrCreateUser: (email: string, name: string) => ({ ...user, email, name }) };

    expect(resolveSessionUser({ user: { email: 'linden@feedmob.com', name: 'Linden' } }, database)).toEqual(user);
  });
});
