import { NextRequest, NextResponse } from 'next/server';
import { createDatabase } from '@/lib/db';
import { getAuthenticatedRequestUser } from '@/lib/session-request-user';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedRequestUser();
  if (!user) return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Sign in is required.' }, { status: 401 });
  const { id } = await params;
  const db = createDatabase();
  try {
    const secret = db.revealApiKey(user.id, id);
    return NextResponse.json({ secret });
  } catch (error) {
    return NextResponse.json({ code: 'NOT_FOUND', message: error instanceof Error ? error.message : 'API key not found.' }, { status: 404 });
  } finally {
    db.close();
  }
}
