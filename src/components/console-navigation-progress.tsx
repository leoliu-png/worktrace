'use client';

import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { consoleLoadingMessage, pendingNavigationClass } from '@/lib/console-loading';

type NavigationContextValue = { destination: string | null; navigate: (href: string) => void };
const NavigationContext = createContext<NavigationContextValue | null>(null);

export function ConsoleNavigationProgress({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => { if (destination === pathname) setDestination(null); }, [destination, pathname]);
  const navigate = (href: string) => { if (href !== pathname) { setDestination(href); router.push(href); } };
  return <NavigationContext.Provider value={{ destination, navigate }}>{children}</NavigationContext.Provider>;
}

export function ConsoleNavigationLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const context = useContext(NavigationContext);
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!context || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); context.navigate(href);
  }
  return <a href={href} className={pendingNavigationClass(className ?? '', context?.destination ?? null, href)} onClick={onClick}>{children}</a>;
}

export function ConsoleContentLoading() {
  const context = useContext(NavigationContext);
  if (!context?.destination) return null;
  return <div className="wt-content-loading" role="status"><span className="wt-loading-spinner" aria-hidden />{consoleLoadingMessage(context.destination)}</div>;
}
