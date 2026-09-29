import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDatabase } from '@/lib/db';
import { getAuthenticatedRequestUser } from '@/lib/session-request-user';
import { requireAdministrator } from '@/lib/admin';

const roleInput = z.object({ role: z.enum(['ADMIN', 'MEMBER']) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedRequestUser();
  if (!user) return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Sign in is required.' }, { status: 401 });
  try {
    requireAdministrator(user);
  } catch {
    return NextResponse.json({ code: 'FORBIDDEN', message: 'Administrator access is required.' }, { status: 403 });
  }
  const parsed = roleInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
  const { id } = await params;
  const db = createDatabase();
  try {
    const data = db.setUserRole(id, parsed.data.role, user.id);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ code: 'CONFLICT', message: error instanceof Error ? error.message : 'Role update failed.' }, { status: 409 });
  } finally {
    db.close();
  }
}
