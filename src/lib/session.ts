import { auth } from '@/auth';
import { cache } from 'react';
import type { AppRole } from './access';

export const currentConsoleUser = cache(async (): Promise<{ id: string; email: string; name: string; image: string | null; role: AppRole } | undefined> => {
  const session = await auth();
  if (!session?.user?.email || !session.user.id || !session.user.role) return undefined;
  return { id: session.user.id, email: session.user.email, name: session.user.name ?? session.user.email, image: session.user.image ?? null, role: session.user.role };
});
