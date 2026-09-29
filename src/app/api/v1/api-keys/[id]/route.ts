import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDatabase } from '@/lib/db';
import { getAuthenticatedRequestUser } from '@/lib/session-request-user';

const statusInput = z.object({ status: z.enum(['ACTIVE', 'DISABLED', 'REVOKED']) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedRequestUser();
  if (!user) return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Sign in is required.' }, { status: 401 });
  const parsed = statusInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
  const { id } = await params;
  const db = createDatabase();
  try {
    const data = db.setApiKeyStatus(user.id, id, parsed.data.status);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ code: 'NOT_FOUND', message: error instanceof Error ? error.message : 'API key not found.' }, { status: 404 });
  } finally {
    db.close();
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedRequestUser();
  if (!user) return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Sign in is required.' }, { status: 401 });
  const { id } = await params;
  const db = createDatabase();
  try {
    const data = db.setApiKeyStatus(user.id, id, 'REVOKED');
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ code: 'NOT_FOUND', message: error instanceof Error ? error.message : 'API key not found.' }, { status: 404 });
  } finally {
    db.close();
  }
}
