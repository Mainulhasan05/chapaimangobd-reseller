'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { Route } from 'next';
import { useSession, useLogout } from '@/lib/session';
import { t, type DictKey } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/button';
import type { Role } from '@/lib/types';

export type NavItem = { href: Route; labelKey: DictKey };

/**
 * The frame both dashboards share. It also performs the client side half of the
 * role check: the proxy already redirected anyone without a cookie, and Express
 * refuses the data regardless, so this only stops a wrong-role user staring at an
 * empty shell.
 */
export function AppShell({
  role,
  nav,
  children,
}: {
  role: Role;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isLoading } = useSession();
  const logout = useLogout();

  useEffect(() => {
    if (isLoading) return;
    if (!session) {
      router.replace('/login');
    } else if (session.user.role !== role) {
      router.replace(session.user.role === 'owner' ? '/owner' : '/reseller');
    }
  }, [session, isLoading, role, router]);

  if (isLoading || !session || session.user.role !== role) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href={role === 'owner' ? '/owner' : '/reseller'} className="font-semibold">
            {t('app.name')}
          </Link>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session.user.name}
            </span>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {t('auth.logout')}
            </button>
          </div>
        </div>

        {/* Horizontal nav that scrolls on a phone rather than wrapping into rows. */}
        <nav className="scroll-x border-t border-border">
          <div className="mx-auto flex max-w-6xl gap-1 px-2 py-1">
            {nav.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'whitespace-nowrap rounded-md px-3 py-2 text-sm',
                    active
                      ? 'bg-primary/15 font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
