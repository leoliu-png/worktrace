import { NextRequest } from 'next/server';
import { createDatabase, type LocalUser } from './db';

export function getDevelopmentUser(request: NextRequest): LocalUser | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  const email = request.headers.get('x-worktrace-user');
  if (!email?.endsWith('@feedmob.com')) return undefined;
  const name = request.headers.get('x-worktrace-name') ?? email.split('@')[0] ?? 'WorkTrace member';
  const db = createDatabase();
  const user = db.findOrCreateUser(email, name);
  db.close();
  return user;
}
