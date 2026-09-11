'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Route } from 'next';
import { Bell, ChevronDown, ChevronRight, Ellipsis, LogOut, WifiOff } from 'lucide-react';
import { useSession, useLogout } from '@/lib/session';
import { useOnline } from '@/lib/use-online';
import { t, type DictKey } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/modal';
import { Avatar } from '@/components/ui/layout';
import { Logo } from '@/components/ui/logo';
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
 * How many pills reach the header.
 *
 * The owner has ten destinations. Ten pills plus a logo plus a profile is wider
 * than a 1280px viewport, and a centred row that overflows is worse than a long
 * one: `justify-content: center` in a scroll container puts the first item off
 * the left edge where it cannot be scrolled back to. Six fits at `lg` with room
 * to spare, and the setup screens that fall past it are visited once a season.
 */
const PILLS = 6;

/**
 * The frame both dashboards share.
 *
 * Navigation used to be a horizontally scrolling strip in the header, holding
 * seven items for a reseller and ten for an owner. About three were visible on a
 * phone, with no fade or arrow to say the rest existed, and all of them sat at
 * the top of the screen, as far from a thumb as a control can get. It is now a
 * bottom bar on a phone and a centred row of pills from `sm` up, where a wide
 * viewport and a pointer make a top bar the right shape again.
 *
 * It also performs the client side half of the role check: the proxy already
 * redirected anyone without a cookie, and Express refuses the data regardless,
 * so this only stops a wrong-role user staring at an empty shell.
 */
export function AppShell({
  role,
  nav,
  notificationsHref,
  notificationCount,
  children,
}: {
  role: Role;
  nav: NavItem[];
  /** Where the bell goes. Omitted for a role with no notification inbox. */
  notificationsHref?: Route;
  notificationCount?: number;
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
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <Skeleton className="mb-6 h-8 w-40" />
          <ListSkeleton rows={4} />
        </div>
      </div>
    );
  }

  const tabs = nav.slice(0, TABS);
  const overflow = nav.slice(TABS);
  const overflowActive = overflow.some((item) => isActive(item.href));
  const pills = nav.slice(0, PILLS);
  const pillOverflow = nav.slice(PILLS);
  const home = (role === 'owner' ? '/owner' : '/reseller') as Route;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href={home} className="flex shrink-0 items-center gap-2">
            <Logo />
            <span className="hidden truncate font-bold tracking-tight sm:inline">
              {t('app.name')}
            </span>
          </Link>

          {/*
           * Centred, so the row of pills reads as the app's spine rather than as
           * a list that happens to start after the logo. From `sm` up there is
           * room for every destination at once, which is the whole reason the
           * bottom bar exists only below it.
           */}
          <nav className="hidden flex-1 justify-center sm:flex">
            <div className="flex items-center gap-1">
              {pills.map((item) => (
                <NavPill key={item.href} item={item} active={isActive(item.href)} />
              ))}
              {pillOverflow.length > 0 && (
                <NavMore items={pillOverflow} isActive={isActive} />
              )}
            </div>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0">
            {notificationsHref && (
              <Link
                href={notificationsHref}
                aria-label={t('nav.notifications')}
                className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Bell className="h-[1.125rem] w-[1.125rem]" />
                {/* A dot, not a count. The count lives on the page itself. */}
                {notificationCount ? (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
                ) : null}
              </Link>
            )}

            <ProfileMenu
              name={session.user.name}
              role={role}
              onLogout={() => logout.mutate()}
              loggingOut={logout.isPending}
            />
          </div>
        </div>

        {!online && (
          <div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-xs font-semibold text-warning-ink">
            <WifiOff className="h-3.5 w-3.5" />
            {t('app.offline')}
          </div>
        )}
      </header>

      {/*
       * Keyed on the path so the arrival plays once per destination. Without the
       * key React keeps the same element across a navigation and the animation
       * never re-runs, which is the usual reason these look broken.
       */}
      <main key={pathname} className="page-in mx-auto max-w-7xl px-4 py-8 pb-nav sm:px-6">
        {children}
      </main>

      {/* The bottom bar. Phones only; `sm` keeps the pills in the header. */}
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
                'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[0.6875rem]',
                overflowActive ? 'text-primary-ink' : 'text-muted-foreground'
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                  overflowActive && 'bg-primary-softer'
                )}
              >
                <Ellipsis className="h-5 w-5" />
              </span>
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
                onClick={() => setMoreOpen(false)}
                className="tap flex items-center gap-3 rounded-lg py-1 text-sm hover:bg-muted"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-subtle text-muted-foreground">
                  <item.icon className="h-[1.125rem] w-[1.125rem]" />
                </span>
                <span className={cn('flex-1', isActive(item.href) && 'font-semibold')}>
                  {t(item.labelKey)}
                </span>
                {item.badge ? (
                  <span className="tabular rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-danger-foreground">
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

/** One destination in the header row. */
function NavPill({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm transition-all',
        active
          ? 'bg-primary-softer font-semibold text-primary-ink shadow-[inset_0_0_0_1px_oklch(0.546_0.244_263/0.12)]'
          : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {t(item.labelKey)}
      {item.badge ? (
        <span className="tabular rounded-full bg-danger px-1.5 text-xs font-semibold text-danger-foreground">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The destinations past the sixth, on a wide screen.
 *
 * It carries the active state of whatever is inside it, so a reader on the zones
 * page can still see where they are without opening the menu to find out.
 */
function NavMore({
  items,
  isActive,
}: {
  items: NavItem[];
  isActive: (href: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = items.some((item) => isActive(item.href));

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors',
          active || open
            ? 'bg-primary-softer font-semibold text-primary-ink'
            : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        {t('nav.more')}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="menu-in elev-3 absolute left-1/2 top-full z-40 mt-1.5 min-w-52 -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface py-1"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              // The route changes without unmounting this menu, so following a
              // link inside it has to close it explicitly.
              onClick={() => setOpen(false)}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-muted',
                isActive(item.href) ? 'font-semibold text-primary-ink' : 'text-foreground'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0 opacity-70" />
              <span className="flex-1 truncate">{t(item.labelKey)}</span>
              {item.badge ? (
                <span className="tabular rounded-full bg-danger px-1.5 text-xs font-semibold text-danger-foreground">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Name, role and the way out.
 *
 * Logout used to be a bare icon button sitting in the header at all times, which
 * put a destructive action one mis-tap from every screen. It is now behind the
 * avatar, where the rest of the account belongs.
 */
function ProfileMenu({
  name,
  role,
  onLogout,
  loggingOut,
}: {
  name: string;
  role: Role;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const roleLabel = t(role === 'owner' ? 'role.owner' : 'role.reseller');

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('app.profile')}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-muted sm:pr-2',
          open && 'bg-muted'
        )}
      >
        <Avatar name={name} size="md" />
        <span className="hidden min-w-0 text-left leading-tight lg:block">
          <span className="block max-w-28 truncate text-xs font-semibold">{name}</span>
          <span className="block text-[0.6875rem] text-muted-foreground">{roleLabel}</span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="menu-in elev-3 absolute right-0 top-full z-40 mt-1.5 min-w-52 overflow-hidden rounded-xl border border-border bg-surface"
        >
          <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
            <Avatar name={name} size="lg" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{name}</span>
              <span className="block text-xs text-muted-foreground">{roleLabel}</span>
            </span>
          </div>

          <button
            type="button"
            role="menuitem"
            disabled={loggingOut}
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {t('auth.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[0.6875rem]',
        active ? 'font-semibold text-primary-ink' : 'text-muted-foreground'
      )}
    >
      {/*
       * The active state is a filled pill behind the icon rather than a hairline
       * above the tab. At a glance from arm's length the hairline was invisible,
       * and colour alone was carrying the whole signal.
       */}
      <span
        className={cn(
          'relative flex h-7 w-12 items-center justify-center rounded-full transition-colors',
          active && 'bg-primary-softer'
        )}
      >
        <item.icon className="h-5 w-5" />
        {item.badge ? (
          <span className="tabular absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[0.625rem] font-semibold leading-4 text-danger-foreground ring-2 ring-surface">
            {item.badge > 9 ? '9+' : item.badge}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate px-1">{t(item.labelKey)}</span>
    </Link>
  );
}
