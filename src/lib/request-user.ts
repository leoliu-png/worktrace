import type { LocalUser } from './db';

type SessionLike = { user?: { email?: string | null; name?: string | null } | null } | null | undefined;
type UserStore = { findOrCreateUser(email: string, name: string): LocalUser };

export function resolveSessionUser(session: SessionLike, database: UserStore): LocalUser | undefined {
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email?.endsWith('@feedmob.com')) return undefined;
  return database.findOrCreateUser(email, session?.user?.name?.trim() || email.split('@')[0] || 'WorkTrace member');
}
