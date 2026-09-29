import { NextRequest, NextResponse } from 'next/server';
import { createDatabase } from '@/lib/db';
import { getAuthenticatedRequestUser } from '@/lib/session-request-user';
import { requireAdministrator } from '@/lib/admin';

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedRequestUser();
  if (!user) return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Sign in is required.' }, { status: 401 });
  try {
    requireAdministrator(user);
  } catch {
    return NextResponse.json({ code: 'FORBIDDEN', message: 'Administrator access is required.' }, { status: 403 });
  }
  const db = createDatabase();
  const data = db.listUsers();
  db.close();
  return NextResponse.json({ data });
}
