import 'next-auth';
import 'next-auth/jwt';
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User { id: string; role: 'ADMIN' | 'MEMBER'; }
  interface Session { user: DefaultSession['user'] & User; }
}

declare module 'next-auth/jwt' {
  interface JWT { role?: 'ADMIN' | 'MEMBER'; worktraceUserId?: string; }
}
