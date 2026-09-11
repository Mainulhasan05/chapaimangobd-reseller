'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Route } from 'next';
import { Bell, CalendarDays, ChevronRight, Ellipsis, LogOut, WifiOff } from 'lucide-react';
import { useSession, useLogout } from '@/lib/session';
import { useOnline } from '@/lib/use-online';
import { t, type DictKey } from '@/lib/i18n/bn';
import { formatToday } from '@/lib/format';
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
  /**
   * Heading this item sits under in the sidebar. Consecutive items sharing a
   * value are drawn as one group. Ignored on a phone, where the bottom bar has
   * no room for headings and the first four items are the whole story.
   */
  section?: DictKey;
};

/**
 * How many destinations reach the bottom bar. The fifth slot is always More, and
 * five is the point past which the labels stop fitting on a 360px screen.
 */
const TABS = 4;

/**
 * The frame both dashboards share.
 *
 * Navigation has moved twice. It began as a horizontally scrolling strip in the
 * header, then became a bottom bar on a phone and a centred row of pills above
 * `sm`. The pills were the weak half: the owner has ten destinations, six fitted,
 * and the remaining four hid behind a More menu on the widest screens in the
 * product, which is precisely where there was room to spare.
 *
 * So a wide screen now gets a sidebar. Every destination is visible at once,
 * grouped by how often it is touched, and the horizontal band across the top is
 * gone. A phone keeps the bottom bar, because a thumb reaches the bottom of a
 * screen and not the side of one.
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
  const home = (role === 'owner' ? '/owner' : '/reseller') as Route;

  /*
   * Distinct section headings in the order the layout listed them. Derived
   * rather than accumulated, because building this by pushing into an array
   * during render is a mutation the compiler is right to object to.
   */
  const sections = Array.from(new Set(nav.map((item) => item.section)));

  /*
   * The deepest match rather than the first, so `/owner/orders` does not lose
   * to a hypothetical `/owner` prefix and leave every page named Dashboard.
   */
  const current = nav
    .filter((item) => isActive(item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
      {/*
       * The sidebar owns the full height of the viewport and scrolls its own
       * list, so the brand stays at the top and the account stays at the bottom
       * no matter how long the page beside it gets.
       */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
          <Link href={home} className="flex min-w-0 items-center gap-2.5">
            <Logo />
            <span className="truncate font-bold tracking-tight">{t('app.name')}</span>
          </Link>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {sections.map((section) => (
            <div key={section ?? 'main'} className="mb-1">
              {section && (
                <p className="px-3 pb-1.5 pt-4 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(section)}
                </p>
              )}
              <ul className="space-y-0.5">
                {nav
                  .filter((item) => item.section === section)
                  .map((item) => (
                    <li key={item.href}>
                      <SideLink item={item} active={isActive(item.href)} />
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border p-3">
          <ProfileMenu
            name={session.user.name}
            role={role}
            placement="top"
            full
            onLogout={() => logout.mutate()}
            loggingOut={logout.isPending}
          />
        </div>
      </aside>

      <div className="min-w-0">
        {/*
         * The top bar, at every width.
         *
         * It used to stop at `lg`, on the reasoning that the sidebar had taken
         * over. What that left was a content column beginning in mid air, with
         * a notification bell floating above the page heading and nothing to
         * hold it. A dashboard with a sidebar still needs a bar across the top:
         * it is where the current place is named and where the controls that
         * are not destinations live.
         *
         * The two halves swap at `lg`. Below it the bar carries the brand,
         * because there is no sidebar to carry it and the account has nowhere
         * else to go. At `lg` the sidebar has both, so the bar names the page
         * instead.
         */}
        <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
            <Link href={home} className="flex shrink-0 items-center gap-2 lg:hidden">
              <Logo />
              <span className="hidden truncate font-bold tracking-tight sm:inline">
                {t('app.name')}
              </span>
            </Link>

            {/*
             * Where you are, taken from the same nav the sidebar is drawn from,
             * so a new destination cannot arrive with an unnamed bar. A detail
             * route falls under its section, which is what the highlighted
             * sidebar row already says.
             */}
            <h1 className="hidden min-w-0 truncate text-base font-semibold tracking-tight lg:block">
              {current ? t(current.labelKey) : t('app.name')}
            </h1>

            <div className="ml-auto flex shrink-0 items-center gap-1">
              <TodayChip />

              {notificationsHref && (
                <NotificationBell href={notificationsHref} count={notificationCount} />
              )}

              {/* At `lg` the account lives in the sidebar footer, so it is not
                * repeated here: two ways to log out, both on screen at once, is
                * one more than anybody needs. */}
              <div className="lg:hidden">
                <ProfileMenu
                  name={session.user.name}
                  role={role}
                  onLogout={() => logout.mutate()}
                  loggingOut={logout.isPending}
                />
              </div>
            </div>
          </div>

          {!online && <OfflineStrip />}
        </header>

        {/*
         * Keyed on the path so the arrival plays once per destination. Without the
         * key React keeps the same element across a navigation and the animation
         * never re-runs, which is the usual reason these look broken.
         */}
        <main key={pathname} className="page-in mx-auto max-w-7xl px-4 py-8 pb-nav sm:px-6 lg:px-8">
          {children}
        </main>
      </div>

      {/* The bottom bar. Everything below the sidebar breakpoint. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-safe backdrop-blur lg:hidden">
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

/**
 * Which day the business is on.
 *
 * Half the screens in here say "today" - today's orders, today's takings - and
 * none of them said which day that was. It is the Dhaka date, not the device's,
 * because a phone with a wrong clock should not move the business into
 * yesterday. Hidden on the narrowest screens, where the bar has room for the
 * brand and the controls and nothing else.
 */
function TodayChip() {
  return (
    <span className="mr-1 hidden items-center gap-1.5 rounded-lg bg-subtle px-2.5 py-1.5 text-xs font-medium text-muted-foreground sm:flex">
      <CalendarDays aria-hidden className="h-3.5 w-3.5" />
      {formatToday()}
    </span>
  );
}

function OfflineStrip() {
  return (
    <div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-xs font-semibold text-warning-ink">
      <WifiOff className="h-3.5 w-3.5" />
      {t('app.offline')}
    </div>
  );
}

function NotificationBell({ href, count }: { href: Route; count?: number }) {
  return (
    <Link
      href={href}
      aria-label={t('nav.notifications')}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Bell className="h-[1.125rem] w-[1.125rem]" />
      {/* A dot, not a count. The count lives on the page itself. */}
      {count ? (
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
      ) : null}
    </Link>
  );
}

/**
 * One destination in the sidebar.
 *
 * The active state is a filled row with a short bar against the left edge. The
 * fill alone was the whole signal in the header pills, which is fine for a
 * horizontal row of six but weak in a vertical list of ten, where the eye is
 * scanning down an edge rather than across a band.
 */
function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
        active
          ? 'bg-primary-soft font-semibold text-primary-ink'
          : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"
        />
      )}
      <item.icon
        className={cn('h-[1.125rem] w-[1.125rem] shrink-0', !active && 'opacity-80')}
      />
      <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
      {item.badge ? (
        <span className="tabular shrink-0 rounded-full bg-danger px-1.5 text-xs font-semibold text-danger-foreground">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Name, role and the way out.
 *
 * Logout used to be a bare icon button sitting in the header at all times, which
 * put a destructive action one mis-tap from every screen. It is now behind the
 * avatar, where the rest of the account belongs. In the sidebar it fills the
 * footer and opens upward, because there is nothing below it to open into.
 */
function ProfileMenu({
  name,
  role,
  onLogout,
  loggingOut,
  placement = 'bottom',
  full,
}: {
  name: string;
  role: Role;
  onLogout: () => void;
  loggingOut: boolean;
  placement?: 'bottom' | 'top';
  /** Stretches the trigger to the width of its container, for the sidebar footer. */
  full?: boolean;
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
    <div ref={rootRef} className={cn('relative', full && 'w-full')}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('app.profile')}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-muted sm:pr-2',
          full && 'w-full gap-2.5 p-2',
          open && 'bg-muted'
        )}
      >
        <Avatar name={name} size="md" />
        <span
          className={cn(
            'hidden min-w-0 text-left leading-tight lg:block',
            full && 'block flex-1'
          )}
        >
          <span className={cn('block truncate text-xs font-semibold', !full && 'max-w-28')}>
            {name}
          </span>
          <span className="block text-[0.6875rem] text-muted-foreground">{roleLabel}</span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'menu-in elev-3 absolute z-40 min-w-52 overflow-hidden rounded-xl border border-border bg-surface',
            placement === 'top' ? 'bottom-full left-0 mb-1.5 w-full' : 'right-0 top-full mt-1.5'
          )}
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
