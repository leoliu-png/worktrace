import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDatabase } from '@/lib/db';
import { validateAgentWorkLog } from '@/lib/agent-work-logs';
import { resolveApiKeyOrSessionUser } from '@/lib/request-auth';
import { auth } from '@/auth';

const maxPayloadBytes = 64 * 1024;
const idempotencyKey = z.string().regex(/^[\x21-\x7e]{1,128}$/);
const failure = (code: string, message: string, status: number) => NextResponse.json({ code, message }, { status });

async function resolveRequestUser(request: NextRequest, database: ReturnType<typeof createDatabase>) {
  const authorization = request.headers.get('authorization');
  if (authorization !== null) return resolveApiKeyOrSessionUser(authorization, database, undefined);
  const session = await auth();
  if (!session?.user?.email) return undefined;
  return resolveApiKeyOrSessionUser(null, database, database.findOrCreateUser(session.user.email.toLowerCase(), session.user.name ?? session.user.email));
}

export async function GET(request: NextRequest) {
  const db = createDatabase();
  try {
    const user = await resolveRequestUser(request, db);
    if (!user) return failure('UNAUTHORIZED', 'Authentication is required.', 401);
    const teamRequested = request.nextUrl.searchParams.get('team') === 'true';
    return NextResponse.json({ data: db.queryWorkLogs({ authorId: teamRequested ? undefined : user.id, limit: 50 }).items });
  } catch { return failure('SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.', 503); } finally { db.close(); }
}

export async function POST(request: NextRequest) {
  const db = createDatabase();
  try {
    const user = await resolveRequestUser(request, db);
    if (!user) return failure('UNAUTHORIZED', 'Authentication is required.', 401);
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > maxPayloadBytes) return failure('PAYLOAD_TOO_LARGE', 'Request payload is too large.', 413);
    let body: unknown;
    try { const raw = await request.text(); if (Buffer.byteLength(raw, 'utf8') > maxPayloadBytes) return failure('PAYLOAD_TOO_LARGE', 'Request payload is too large.', 413); body = JSON.parse(raw); } catch { return failure('INVALID_JSON', 'Request body must be valid JSON.', 400); }
    const parsed = validateAgentWorkLog(body);
    if (!parsed.success) return failure('VALIDATION_ERROR', 'Request data is invalid.', 400);
    const suppliedKey = request.headers.get('idempotency-key');
    if (suppliedKey && !idempotencyKey.safeParse(suppliedKey).success) return failure('VALIDATION_ERROR', 'Idempotency-Key is invalid.', 400);
    const result = suppliedKey ? db.upsertDailyWorkLogIdempotent(user.id, parsed.data, suppliedKey) : db.upsertDailyWorkLog(user.id, parsed.data);
    return NextResponse.json({ data: result.log }, { status: result.created ? 201 : 200 });
  } catch { return failure('SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.', 503); } finally { db.close(); }
}
