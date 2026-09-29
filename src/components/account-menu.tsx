'use client';

import { useState } from 'react';
import { signOutOfWorkTrace } from '@/app/actions/auth';

type AccountMenuProps = { name: string; email: string; image: string | null };

export function AccountMenu({ name, email, image }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const initial = name.trim().slice(0, 1).toUpperCase() || email.slice(0, 1).toUpperCase();

  return <div className="console-account">
    <button className="console-avatar-button" type="button" aria-label="打开账户菜单" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {image ? <img src={image} alt={`${name} 的头像`} referrerPolicy="no-referrer" /> : <span>{initial}</span>}
    </button>
    {open && <div className="console-account-menu">
      <div className="console-account-summary">
        {image ? <img src={image} alt="" referrerPolicy="no-referrer" /> : <span>{initial}</span>}
        <div><strong>{name}</strong><small>{email}</small></div>
      </div>
      <form action={signOutOfWorkTrace}><button type="submit">退出登录</button></form>
    </div>}
  </div>;
}
