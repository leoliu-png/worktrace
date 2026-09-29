export function requireAdministrator(user: { role: 'ADMIN' | 'MEMBER' }): void {
  if (user.role !== 'ADMIN') throw new Error('Administrator access is required');
}
