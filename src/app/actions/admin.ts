'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { createDatabase } from '@/lib/db';

export async function changeMemberRole(formData: FormData) {
  const actor = (await auth())?.user;
  const userId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? '');
  if (!actor?.id || actor.role !== 'ADMIN' || !userId || !['ADMIN', 'MEMBER'].includes(role)) return;
  const database = createDatabase();
  try {
    database.setUserRole(userId, role as 'ADMIN' | 'MEMBER', actor.id);
  } finally {
    database.close();
  }
  revalidatePath('/console/admin/members');
  revalidatePath('/console/admin/audit');
}

export async function deleteMember(formData: FormData) {
  const actor = (await auth())?.user;
  const userId = String(formData.get('userId') ?? '');
  if (!actor?.id || actor.role !== 'ADMIN' || !userId) return;
  const database = createDatabase();
  try {
    database.deleteUser(userId, actor.id);
  } finally {
    database.close();
  }
  revalidatePath('/console/admin/members');
  revalidatePath('/console/admin/audit');
  revalidatePath('/console/admin/logs');
}
