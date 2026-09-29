import { auth } from '@/auth';
import { createDatabase, type LocalUser } from './db';
import { resolveSessionUser } from './request-user';

export async function getAuthenticatedRequestUser(): Promise<LocalUser | undefined> {
  const session = await auth();
  const database = createDatabase();
  try {
    return resolveSessionUser(session, database);
  } finally {
    database.close();
  }
}
