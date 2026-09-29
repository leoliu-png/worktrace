'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { createApiKey } from '@/lib/api-keys';
import { createDatabase } from '@/lib/db';

export type ApiKeyCreateState = { secret?: string; error?: string };

export async function createPersonalApiKey(_previousState: ApiKeyCreateState, formData: FormData): Promise<ApiKeyCreateState> {
  const user = (await auth())?.user;
  const name = String(formData.get('name') ?? '').trim();
  if (!user?.id) return { error: '登录会话已失效，请重新登录。' };
  if (!name) return { error: '请填写 Key 名称。' };
  const database = createDatabase();
  const generated = createApiKey(name);
  try { database.createApiKey(user.id, generated); } finally { database.close(); }
  revalidatePath('/console/api-keys');
  return { secret: generated.secret };
}

export async function changePersonalApiKeyStatus(formData: FormData) {
  const user = (await auth())?.user;
  const keyId = String(formData.get('keyId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!user?.id || !keyId || !['ACTIVE', 'DISABLED', 'REVOKED'].includes(status)) return;
  const database = createDatabase();
  database.setApiKeyStatus(user.id, keyId, status as 'ACTIVE' | 'DISABLED' | 'REVOKED');
  database.close();
  revalidatePath('/console/api-keys');
}
