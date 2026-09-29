'use server';

import { signIn, signOut } from '@/auth';

export async function signInWithGoogle() {
  await signIn('google', { redirectTo: '/console' });
}

export async function signOutOfWorkTrace() {
  await signOut({ redirectTo: '/' });
}
