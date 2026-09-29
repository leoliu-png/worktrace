import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createApiKey } from '@/lib/api-keys';
import { createDatabase } from '@/lib/db';
import { getAuthenticatedRequestUser } from '@/lib/session-request-user';

const createInput = z.object({ name: z.string().trim().min(1).max(80) });

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedRequestUser();
  if (!user) return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Sign in is required.' }, { status: 401 });
  const db = createDatabase();
  const data = db.listApiKeys(user.id);
  db.close();
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedRequestUser();
  if (!user) return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Sign in is required.' }, { status: 401 });
  const parsed = createInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
  const generated = createApiKey(parsed.data.name);
  const db = createDatabase();
  const key = db.createApiKey(user.id, generated);
  db.close();
  return NextResponse.json({ data: key, secret: generated.secret }, { status: 201 });
}
