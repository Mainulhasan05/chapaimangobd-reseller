/*
 * Service worker for web push.
 *
 * Deliberately minimal: it does not cache anything. Caching a dashboard that
 * shows a wallet balance would be worse than useless, because a stale balance
 * is a wrong balance.
 */

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
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: payload.data || {},
      tag: (payload.data && payload.data.orderCode) || undefined,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = event.notification.data && event.notification.data.orderId
    ? `/reseller/orders?open=${event.notification.data.orderId}`
    : '/reseller';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse an open tab rather than piling up new ones.
      for (const client of clients) {
        if (client.url.includes('/reseller') && 'focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

/*
 * A subscription can be rotated by the browser. Re-registering here keeps the
 * server row alive; without it the user silently stops receiving anything.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
      .then((subscription) =>
        fetch('/api/reseller/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(subscription.toJSON()),
        })
      )
      .catch(() => {})
  );
});
