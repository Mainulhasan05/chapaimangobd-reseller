'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Route } from 'next';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Ellipsis,
  Lock,
  LogOut,
  Menu,
  UserCog,
  WifiOff,
  X,
} from 'lucide-react';
import { useSession, useLogout } from '@/lib/session';
import { useOnline } from '@/lib/use-online';
import { syncPushRole } from '@/lib/push';
import { t, tf, type DictKey } from '@/lib/i18n/bn';
import { formatNumber, formatToday } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Alert, Avatar } from '@/components/ui/layout';
import { Logo } from '@/components/ui/logo';
import { IN_APP_KEY } from '@/components/ui/back-link';
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
  /**
   * A shorter name for the bottom bar, where a tab is about 70px wide at 11px.
   * "জমা ও উত্তোলন" fits a sidebar row and not a tab.
   */
  shortLabelKey?: DictKey;
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
 * `sm`. The pills were the weak half: the owner had ten destinations (now about
 * twenty), six fitted, and the rest hid behind a More menu on the widest screens
 * in the product, which is precisely where there was room to spare.
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
  const [menuOpen, setMenuOpen] = useState(false);
  // Stable, so the drawer's open effect (which pins the page and moves focus)
  // does not re-run each time the shell re-renders on a background refresh.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const accountHref = (role === 'owner' ? '/owner/account' : '/reseller/account') as Route;

  useEffect(() => {
    if (isLoading) return;
    if (!session) {
      // Back to where they were once signed in again, not to the dashboard.
      router.replace(`/login?next=${encodeURIComponent(pathname)}` as Route);
    } else if (session.user.role !== role) {
      router.replace(session.user.role === 'owner' ? '/owner' : '/reseller');
    } else if (session.user.mustChangePassword && pathname !== accountHref) {
      // A temporary password from the owner is good for one thing: choosing a
      // real one. Every other screen waits until that is done.
      router.replace(accountHref);
    }
  }, [session, isLoading, role, router, pathname, accountHref]);

  /*
   * A refusal that means this screen's session is out of date (a temporary
   * password, a deactivation) refreshes the session from the store's listener
   * middleware, so the redirect above and the read-only banner follow it. See
   * lib/store/store.ts.
   */

  /*
   * Remembers that this tab has moved between pages, which is what lets a
   * detail page's back arrow go back instead of opening its list fresh. The
   * first page of a visit (opened from a notification or a shared link) has
   * nothing behind it in the app, so the flag is only set from the second.
   */
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname === firstPath.current) return;
    try {
      window.sessionStorage.setItem(IN_APP_KEY, '1');
    } catch {
      // Storage refused (private mode): back arrows fall back to their list.
    }
  }, [pathname]);

  /*
   * While a field has the keyboard open on a phone, the bottom bar steps aside.
   * With the keyboard taking half the screen, a 4rem bar and a save bar riding
   * above it left a sliver for the field being typed in. Bars that sit above
   * the nav use the `above-nav` utility, which drops to the bottom edge then.
   */
  useEffect(() => {
    const isField = (node: EventTarget | null) =>
      node instanceof HTMLElement &&
      (node.matches('textarea, select, [contenteditable="true"]') ||
        (node instanceof HTMLInputElement &&
          !['checkbox', 'radio', 'button', 'submit', 'file', 'range'].includes(node.type)));
    const root = document.documentElement;
    const onFocusIn = (event: FocusEvent) => {
      if (isField(event.target) && window.matchMedia('(max-width: 1023px)').matches) {
        root.dataset.keyboard = '1';
      }
    };
    const onFocusOut = () => {
      // Focus moving from one field to the next keeps the keyboard up.
      window.setTimeout(() => {
        if (!isField(document.activeElement)) delete root.dataset.keyboard;
      }, 50);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      delete root.dataset.keyboard;
    };
  }, []);

  // Keeps the push worker's idea of who is signed in here current, so a tapped
  // notification opens this role's pages even after an account switch.
  const signedInRole = session?.user.role;
  useEffect(() => {
    if (signedInRole === role) void syncPushRole(role);
  }, [signedInRole, role]);

  /*
   * Whether a path falls under a destination. Prefix matching, so an order's
   * detail page still belongs to Orders.
   */
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

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

  /*
   * Exactly one destination is current, and it is the most specific one that
   * matches.
   *
   * Prefix matching alone lit up two rows at once: the dashboard lives at
   * `/owner`, which is a prefix of `/owner/orders`, so standing on Orders
   * highlighted Orders and Dashboard together. Picking the longest match and
   * comparing against that one leaves a single row lit, in the sidebar, in the
   * bottom bar and in the More sheet, because all three ask the same question.
   */
  const current = nav
    .filter((item) => matches(item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];

  const isActive = (href: string) => current?.href === href;

  /*
   * What the bar calls this page. The inbox is reached by the bell rather than
   * from the nav, so it is named here rather than falling back to the brand.
   */
  const title =
    notificationsHref && matches(notificationsHref)
      ? t('nav.notifications')
      : current
        ? t(current.labelKey)
        : t('app.name');

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

  return (
    <div className="app-shell min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
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
            accountHref={accountHref}
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
         * It names the page at every width. Below `lg` it used to carry the
         * brand instead, so on a phone, once the page heading had scrolled
         * away, nothing on screen said where you were; the brand is in the
         * drawer and the home tab already. The account sits here below `lg`,
         * because there is no sidebar footer to hold it.
         */}
        <header className="print-hide sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
            {/*
             * The way into the full map, on the screens that have no sidebar.
             *
             * The bar carried a logo and two controls with a wide empty gap
             * between them, and every destination past the fourth was reachable
             * only through the More button at the far bottom of the screen. The
             * drawer is that whole map, and this is the obvious place to look
             * for it.
             */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label={t('app.menu')}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-muted lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/*
             * Where you are, taken from the same nav the sidebar is drawn from,
             * so a new destination cannot arrive with an unnamed bar. A detail
             * route falls under its section, which is what the highlighted
             * sidebar row already says. Not a heading: every page carries its
             * own `h1`, and a second one would make a screen reader's outline
             * stutter.
             */}
            <p className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{title}</p>

            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
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
                  accountHref={accountHref}
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
        <main key={pathname} className="page-in mx-auto max-w-7xl px-4 py-8 pb-nav sm:px-6 lg:px-8 print:pb-0">
          {role === 'reseller' && !session.user.isActive && <DeactivatedBanner />}
          {/* Pages keep their filters in the URL, and reading the URL needs a
            * suspense boundary while a route is prerendered. One here covers
            * every page. */}
          <Suspense fallback={<ListSkeleton rows={4} />}>{children}</Suspense>
        </main>
      </div>

      {/* The bottom bar. Everything below the sidebar breakpoint. */}
      <nav className="bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-safe backdrop-blur lg:hidden">
        <div className="flex">
          {tabs.map((item) => (
            <TabLink key={item.href} item={item} active={isActive(item.href)} />
          ))}

          {overflow.length > 0 && (
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
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

      <NavDrawer
        open={menuOpen}
        onClose={closeMenu}
        nav={nav}
        sections={sections}
        isActive={isActive}
        home={home}
        name={session.user.name}
        role={role}
        onLogout={() => logout.mutate()}
        loggingOut={logout.isPending}
      />
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

/**
 * A deactivated reseller's standing notice. See docs/adr/0011.
 *
 * Every page they open still works as a record, and the one thing they may
 * still ask for, their money, is one tap away. The pages themselves hide the
 * other writes; this says why they are gone.
 */
function DeactivatedBanner() {
  return (
    <Alert tone="warning" icon={Lock} title={t('inactive.bannerTitle')} className="mb-6">
      <p>{t('inactive.bannerBody')}</p>
      <Link href="/reseller/wallet" className="mt-1 inline-block font-semibold underline underline-offset-2">
        {t('inactive.bannerWithdraw')}
      </Link>
    </Alert>
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

/**
 * The way into the inbox, with how much is waiting in it.
 *
 * It used to carry a dot, on the reasoning that the count lived on the page.
 * But "one new order" and "fourteen things since last night" call for different
 * reactions, and the dot made the owner open the page to learn which. Capped at
 * 9+, like the bottom bar, so the badge never outgrows the bell.
 */
function NotificationBell({ href, count }: { href: Route; count?: number }) {
  return (
    <Link
      href={href}
      aria-label={
        count ? tf('nav.notificationsCount', { count: formatNumber(count) }) : t('nav.notifications')
      }
      className="relative flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Bell className="h-5 w-5" />
      {count ? (
        <span
          aria-hidden
          className="tabular absolute right-1 top-1 min-w-[1.125rem] rounded-full bg-danger px-1 text-center text-[0.625rem] font-semibold leading-[1.125rem] text-danger-foreground ring-2 ring-surface"
        >
          {count > 9 ? `${formatNumber(9)}+` : formatNumber(count)}
        </span>
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
        /*
         * The active item is a solid fill rather than the tinted one it was.
         * A tint and a hover state look alike at a glance, which is the whole
         * job this element has; a filled pill is unmistakable from across a
         * room, and near-black on mango measures 8.09:1, so it costs nothing in
         * legibility to be that emphatic.
         */
        active
          ? 'bg-primary font-semibold text-primary-foreground shadow-[0_4px_12px_color-mix(in_oklch,var(--primary)_38%,transparent)]'
          : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <item.icon
        className={cn('h-[1.125rem] w-[1.125rem] shrink-0', !active && 'opacity-80')}
      />
      <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
      {item.badge ? (
        <span className="tabular shrink-0 rounded-full bg-danger px-1.5 text-xs font-semibold text-danger-foreground">
          {item.badge > 99 ? `${formatNumber(99)}+` : formatNumber(item.badge)}
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
  accountHref,
  onLogout,
  loggingOut,
  placement = 'bottom',
  full,
}: {
  name: string;
  role: Role;
  /** Password, login phone and, for the owner, trusted devices. */
  accountHref: Route;
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

          {/* Behind the avatar is where people look for "change my password";
            * it used to hold only the way out. */}
          <Link
            href={accountHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm transition-colors hover:bg-muted"
          >
            <UserCog className="h-4 w-4 shrink-0 text-muted-foreground" />
            {t('nav.account')}
          </Link>

          <button
            type="button"
            role="menuitem"
            disabled={loggingOut}
            onClick={onLogout}
            className="flex min-h-11 w-full items-center gap-2.5 border-t border-border px-3 text-left text-sm text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
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
            {item.badge > 9 ? `${formatNumber(9)}+` : formatNumber(item.badge)}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate px-1">{t(item.shortLabelKey ?? item.labelKey)}</span>
    </Link>
  );
}

/**
 * The whole map, on a screen too narrow for a sidebar.
 *
 * It replaces the More sheet, which only ever listed the destinations that did
 * not fit in the bottom bar. That made the overflow feel like a scrap heap and
 * left the top bar with nothing in it but a logo and a wide empty gap. This
 * carries every destination, grouped exactly as the sidebar groups them, plus
 * the account, so the two navigations are the same navigation at two widths.
 *
 * Both the hamburger and the bottom bar's More button open it. One menu, two
 * ways in, rather than two menus that each know half the story.
 */
function NavDrawer({
  open,
  onClose,
  nav,
  sections,
  isActive,
  home,
  name,
  role,
  onLogout,
  loggingOut,
}: {
  open: boolean;
  onClose: () => void;
  nav: NavItem[];
  sections: (DictKey | undefined)[];
  isActive: (href: string) => boolean;
  home: Route;
  name: string;
  role: Role;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);

    /*
     * iOS Safari keeps scrolling the page behind an overlay whatever `overflow`
     * says, so it is pinned by position instead, at the cost of having to put
     * the reader back where they were. Same approach as the sheet; see Modal.
     */
    const { body } = document;
    const scrollY = window.scrollY;
    const saved = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey, true);
      body.style.position = saved.position;
      body.style.top = saved.top;
      body.style.width = saved.width;
      body.style.overflow = saved.overflow;
      window.scrollTo(0, scrollY);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const roleLabel = t(role === 'owner' ? 'role.owner' : 'role.reseller');

  return (
    <div
      className="fade-in fixed inset-0 z-50 bg-black/50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={t('app.menu')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="drawer-in elev-3 flex h-full w-[17rem] max-w-[85vw] flex-col bg-surface outline-none"
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <Link href={home} onClick={onClose} className="flex min-w-0 items-center gap-2.5">
            <Logo />
            <span className="truncate font-bold tracking-tight">{t('app.name')}</span>
          </Link>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('app.close')}
            className="-mr-2 ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Its own scroller, so the account stays pinned at the bottom however
          * many destinations a role has. */}
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
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
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={isActive(item.href) ? 'page' : undefined}
                        className={cn(
                          // Forty-four pixels tall, because this is a list tapped
                          // with a thumb rather than clicked with a pointer.
                          'flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                          // Filled, to match the sidebar. The drawer is the
                          // sidebar on a phone and must not disagree with it.
                          isActive(item.href)
                            ? 'bg-primary font-semibold text-primary-foreground'
                            : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <item.icon className="h-[1.125rem] w-[1.125rem] shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                        {item.badge ? (
                          <span className="tabular shrink-0 rounded-full bg-danger px-1.5 text-xs font-semibold text-danger-foreground">
                            {item.badge > 99 ? `${formatNumber(99)}+` : formatNumber(item.badge)}
                          </span>
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 opacity-40" />
                        )}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border p-3 pb-safe-3">
          <div className="flex items-center gap-2.5 px-1 py-2">
            <Avatar name={name} size="lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{name}</span>
              <span className="block text-xs text-muted-foreground">{roleLabel}</span>
            </span>
          </div>

          <button
            type="button"
            disabled={loggingOut}
            onClick={onLogout}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {t('auth.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}
