'use client';

import { useEffect, useState } from 'react';
import { signOutOfWorkTrace } from '@/app/actions/auth';

type RuntimeUser = { name: string; email: string; image: string | null; role: 'ADMIN' | 'MEMBER' };

export function StitchRuntimeFrame({ title, source, user }: { title: string; source: string; user: RuntimeUser }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.origin === window.location.origin && event.data?.type === 'WORKTRACE_ACCOUNT_MENU') setMenuOpen((open) => !open);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return <div className="stitch-runtime-shell">
    <iframe title={title} className="stitch-prototype-frame" srcDoc={source} />
    {menuOpen && <div className="stitch-account-menu" role="menu">
      <div className="stitch-account-summary">
        {user.image ? <img src={user.image} alt="" /> : <span>{user.name.slice(0, 1).toUpperCase()}</span>}
        <div><strong>{user.name}</strong><small>{user.email}</small></div>
      </div>
      <form action={signOutOfWorkTrace}><button type="submit">退出登录</button></form>
    </div>}
  </div>;
}
