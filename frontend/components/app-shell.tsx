'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Route } from 'next';
import { ChevronRight, Ellipsis, LogOut, WifiOff } from 'lucide-react';
import { useSession, useLogout } from '@/lib/session';
import { useOnline } from '@/lib/use-online';
import { t, type DictKey } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/modal';
import { Skeleton, ListSkeleton } from '@/components/ui/skeleton';
import type { Role } from '@/lib/types';

/** Typed loosely so a layout can pass any lucide icon without importing its type. */
type IconComponent = React.ComponentType<{ className?: string }>;

export type NavItem = {
  href: Route;
  labelKey: DictKey;
  icon: IconComponent;
  /** A count to surface on the tab, such as orders waiting to be confirmed. */
  badge?: number;
};

/**
 * How many destinations reach the bottom bar. The fifth slot is always More, and
 * five is the point past which the labels stop fitting on a 360px screen.
 */
const TABS = 4;

/**
 * The frame both dashboards share.
 *
 * Navigation used to be a horizontally scrolling strip in the header, holding
 * seven items for a reseller and ten for an owner. About three were visible on a
 * phone, with no fade or arrow to say the rest existed, and all of them sat at
 * the top of the screen, as far from a thumb as a control can get. It is now a
 * bottom bar on a phone and the same top strip from `sm` up, where a wide
 * viewport and a pointer make it the right shape again.
 *
 * It also performs the client side half of the role check: the proxy already
 * redirected anyone without a cookie, and Express refuses the data regardless,
 * so this only stops a wrong-role user staring at an empty shell.
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
  const online = useOnline();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!session) {
      router.replace('/login');
    } else if (session.user.role !== role) {
      router.replace(session.user.role === 'owner' ? '/owner' : '/reseller');
    }
  }, [session, isLoading, role, router]);

  // Closing on navigation rather than making every item in the sheet do it.
  useEffect(() => setMoreOpen(false), [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  if (isLoading || !session || session.user.role !== role) {
    /*
     * A skeleton, not a centred spinner. The audience is on a cheap phone over a
     * slow connection, and a blank screen with a spinner in the middle of it is
     * indistinguishable from an app that has crashed.
     */
    return (
      <div className="min-h-screen">
        <div className="border-b border-border bg-surface px-4 py-3">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="mx-auto max-w-6xl px-4 py-6">
          <Skeleton className="mb-6 h-8 w-40" />
          <ListSkeleton rows={4} />
        </div>
      </div>
    );
  }

  const tabs = nav.slice(0, TABS);
  const overflow = nav.slice(TABS);
  const overflowActive = overflow.some((item) => isActive(item.href));
  const home = (role === 'owner' ? '/owner' : '/reseller') as Route;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
          <Link href={home} className="truncate font-semibold">
            {t('app.name')}
          </Link>

          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session.user.name}
            </span>
            <button
              type="button"
              onClick={() => logout.mutate()}
              aria-label={t('auth.logout')}
              className="tap flex items-center justify-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t('auth.logout')}</span>
            </button>
          </div>
        </div>

        {/* From `sm` up there is room for every destination at once. */}
        <nav className="scroll-x hidden border-t border-border sm:block">
          <div className="mx-auto flex max-w-6xl gap-1 px-2 py-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'whitespace-nowrap rounded-md px-3 py-2 text-sm',
                  isActive(item.href)
                    ? 'bg-primary/15 font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {t(item.labelKey)}
                {item.badge ? (
                  <span className="ml-1.5 rounded-full bg-danger px-1.5 py-0.5 text-xs text-danger-foreground">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        </nav>

        {!online && (
          <div className="flex items-center justify-center gap-2 bg-warning/25 px-4 py-1.5 text-xs font-medium text-[oklch(0.42_0.11_75)]">
            <WifiOff className="h-3.5 w-3.5" />
            {t('app.offline')}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 pb-nav">{children}</main>

      {/* The bottom bar. Phones only; `sm` keeps the strip in the header. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-safe backdrop-blur sm:hidden">
        <div className="flex">
          {tabs.map((item) => (
            <TabLink key={item.href} item={item} active={isActive(item.href)} />
          ))}

          {overflow.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[0.6875rem]',
                overflowActive ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <Ellipsis className={cn('h-5 w-5', overflowActive && 'text-primary')} />
              <span className="truncate">{t('nav.more')}</span>
            </button>
          )}
        </div>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title={t('app.menu')}>
        <ul className="-my-1 divide-y divide-border">
          {overflow.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="tap flex items-center gap-3 py-1 text-sm hover:bg-muted"
              >
                <item.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className={cn('flex-1', isActive(item.href) && 'font-medium')}>
                  {t(item.labelKey)}
                </span>
                {item.badge ? (
                  <span className="rounded-full bg-danger px-2 py-0.5 text-xs text-danger-foreground">
                    {item.badge}
                  </span>
                ) : null}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[0.6875rem]',
        active ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      <span className="relative">
        <item.icon className={cn('h-5 w-5', active && 'text-primary')} />
        {item.badge ? (
          <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[0.625rem] font-semibold leading-4 text-danger-foreground">
            {item.badge > 9 ? '9+' : item.badge}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate px-1">{t(item.labelKey)}</span>
      {active && (
        <span aria-hidden className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" />
      )}
    </Link>
  );
}
