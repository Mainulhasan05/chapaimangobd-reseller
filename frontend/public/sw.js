/*
 * Service worker for web push.
 *
 * Deliberately minimal: it does not cache any page or API response. Caching a
 * dashboard that shows a wallet balance would be worse than useless, because a
 * stale balance is a wrong balance.
 *
 * It serves both roles. The page tells it which role is signed in on this
 * browser (see `lib/push.ts`), and it keeps that one word in Cache Storage,
 * because a service worker is stopped between events and loses every variable.
 * That role decides where a tapped notification opens and which endpoint a
 * rotated subscription is re-registered with.
 */

const CONFIG_CACHE = 'cm-sw-config-v1';
const ROLE_KEY = '/__sw/role';
const ROLES = ['owner', 'reseller'];

async function readRole() {
  try {
    const cache = await caches.open(CONFIG_CACHE);
    const hit = await cache.match(ROLE_KEY);
    if (!hit) return null;
    const role = (await hit.text()).trim();
    return ROLES.includes(role) ? role : null;
  } catch {
    return null;
  }
}

async function writeRole(role) {
  const cache = await caches.open(CONFIG_CACHE);
  if (ROLES.includes(role)) {
    await cache.put(ROLE_KEY, new Response(role));
  } else {
    await cache.delete(ROLE_KEY);
  }
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.type !== 'set-role') return;
  event.waitUntil(writeRole(message.role));
});

/** A same-origin path, and nothing that could leave this site. */
function isSafePath(value) {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
  );
}

/**
 * Which event a push was, as far as can be told.
 *
 * The server includes `eventType` (and `url`) in the payload since Phase F. A
 * push queued before that carries only the event's fields, so it is recognised
 * by the fields only that event writes (see backend/src/jobs). Anything
 * unrecognised is null.
 */
function eventOf(data) {
  if (!data) return null;
  if (typeof data.eventType === 'string') return data.eventType;
  if (typeof data.driftedCount === 'number') return 'alert.ledger_drift';
  if ('agingCount' in data && 'nearLimitCount' in data) return 'alert.daily_digest';
  if ('balancePoisha' in data && 'creditLimitPoisha' in data) return 'balance.near_limit';
  return null;
}

/**
 * Where a tapped notification goes.
 *
 * An explicit `data.url` wins when the server sends one. Otherwise an order
 * notification opens that order's page; ledger drift opens the reports page,
 * the morning digest the dashboard, and a reseller near their limit the wallet,
 * matching `hrefFor` in `components/notifications-view.tsx`. Anything else
 * opens the inbox, which lists it. Without a known role the root is the safe
 * answer: it sends a signed-in person to their own dashboard.
 */
function targetFor(data, role) {
  if (data && isSafePath(data.url)) return data.url;
  if (!role) return '/';
  if (data && typeof data.orderId === 'string' && /^[a-f0-9]{24}$/i.test(data.orderId)) {
    return `/${role}/orders/${data.orderId}`;
  }

  const event = eventOf(data);
  if (role === 'owner' && event === 'alert.ledger_drift') return '/owner/reports';
  if (role === 'owner' && event === 'alert.daily_digest') return '/owner';
  if (role === 'reseller' && event === 'balance.near_limit') return '/reseller/wallet';

  return `/${role}/notifications`;
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'নতুন বিজ্ঞপ্তি', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'নতুন বিজ্ঞপ্তি', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: payload.data || {},
      tag: (payload.data && payload.data.orderCode) || undefined,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    (async () => {
      const role = await readRole();
      const target = targetFor(event.notification.data, role);
      const url = new URL(target, self.location.origin).href;

      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse an open tab of this app rather than piling up new ones.
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          if ('navigate' in client) await client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});

/** A POST with the session cookie, refreshing the access token once if it expired. */
async function postWithSession(path, body) {
  const send = () =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });

  let response = await send();
  if (response.status === 401) {
    const refreshed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (refreshed.ok) response = await send();
  }
  return response;
}

/*
 * A subscription can be rotated by the browser. Re-registering here keeps the
 * server row alive; without it the user silently stops receiving anything.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const role = await readRole();
      if (!role) return;

      let subscription = event.newSubscription;
      if (!subscription) {
        let options = event.oldSubscription ? event.oldSubscription.options : null;
        if (!options || !options.applicationServerKey) {
          const res = await fetch(`/api/${role}/push/key`, { credentials: 'include' });
          const json = await res.json();
          const publicKey = json && json.ok && json.data ? json.data.publicKey : null;
          if (!publicKey) return;
          options = { userVisibleOnly: true, applicationServerKey: publicKey };
        }
        subscription = await self.registration.pushManager.subscribe(options);
      }

      const { endpoint, keys } = subscription.toJSON();
      await postWithSession(`/api/${role}/push/subscribe`, { endpoint, keys });
    })().catch(() => {})
  );
});
