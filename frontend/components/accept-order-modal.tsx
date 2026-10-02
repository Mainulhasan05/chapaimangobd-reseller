'use client';

import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { useGetSourcesQuery } from '@/lib/store/endpoints/catalog';
import { useAcceptOrderMutation } from '@/lib/store/endpoints/orders';
import type { Order, Source } from '@/lib/types';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/layout';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, FormErrorSummary, Select } from '@/components/ui/form';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { DeliveryChargeField, useDeliveryCharge } from '@/components/delivery-charge-field';
import { CustomerSmsField, useCustomerSms } from '@/components/customer-sms-field';
import { itemAmount } from '@/components/orders-panel';

/*
 * Which orchard each product came from last time, per browser.
 *
 * In season most products come from the same place day after day, so asking
 * afresh on every order made the common case the slow one: forty accepts, forty
 * identical picks. The guess is only a starting value the owner can see and
 * change, and it is dropped the moment that source is archived.
 */
const LAST_SOURCE_KEY = 'accept:lastSource';

export function readLastSources(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(LAST_SOURCE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    // A private window or blocked storage: no memory, nothing else changes.
    return {};
  }
}

export function rememberSources(pairs: { product: string; sourceId: string }[]): void {
  try {
    const next = { ...readLastSources() };
    pairs.forEach(({ product, sourceId }) => (next[product] = sourceId));
    window.localStorage.setItem(LAST_SOURCE_KEY, JSON.stringify(next));
  } catch {
    // Remembering is a convenience; failing to is not worth telling anyone about.
  }
}

/** The sources an order can be accepted against, with the list's loading state. */
export function useAvailableSources() {
  const sources = useGetSourcesQuery();
  const available: Source[] = sources.data?.sources.filter((source) => !source.isArchived) ?? [];
  return { sources, available };
}

/**
 * Accepting an order, which is where the owner says where each line comes from.
 * Mount only while open.
 *
 * A product is fixed and its orchard is not: which source a crate is collected
 * from depends on what is ripe and who has it on the day. So the choice belongs
 * here, at accept, rather than on the product form, and the API refuses an
 * accept that does not make it.
 *
 * Most orders come from one place, so the whole form is one select with a
 * per-line override underneath, each line starting from the orchard that
 * product came from last time.
 */
export function AcceptOrderModal({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  /** After the accept went through; the caller toasts and moves focus on. */
  onDone?: (order: Order) => void;
}) {
  const [accept] = useAcceptOrderMutation();
  const { sources, available } = useAvailableSources();

  // What the owner picked here, keyed by line id so a product appearing twice
  // can still split across two orchards. Unpicked lines fall back to the guess.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [remembered] = useState(readLastSources);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  // Accept is often when the owner first learns what the courier will charge.
  const charge = useDeliveryCharge(order);

  // The optional message to the customer, previewed before it is committed to.
  const sms = useCustomerSms(order, 'accept');

  const isAvailable = (id: string | undefined) =>
    Boolean(id) && available.some((source) => source._id === id);

  const chosenFor = (itemId: string, product: string): string => {
    if (picked[itemId] !== undefined) return picked[itemId];
    const guess = remembered[product];
    return isAvailable(guess) ? guess : '';
  };

  const missing = order.items.filter((item) => !chosenFor(item.id, item.product));

  /** Fills every line at once, which is what most orders need. */
  const setAll = (sourceId: string) => {
    if (!sourceId) return;
    setPicked(Object.fromEntries(order.items.map((item) => [item.id, sourceId])));
  };

  const submit = async () => {
    setTried(true);
    if (missing.length > 0 || !charge.check.ok || sms.preparing) return;
    setBusy(true);
    setError(null);
    try {
      // The charge first, so the accept that follows is taken against the final
      // figure. If the accept then fails, the charge change still stands, and
      // pressing the button again sends it as a no-op.
      await charge.apply();
      const lines = order.items.map((item) => ({
        itemId: item.id,
        sourceId: chosenFor(item.id, item.product),
      }));
      const { order: accepted } = await accept({
        id: order.id,
        sources: lines,
        sendCustomerSms: sms.enabled,
      }).unwrap();
      rememberSources(
        order.items.map((item, index) => ({ product: item.product, sourceId: lines[index].sourceId }))
      );
      onClose();
      onDone?.(accepted);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const noSources = sources.isSuccess && available.length === 0;

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`${t('order.acceptTitle')} · ${order.orderCode}`}
      dirty={Object.keys(picked).length > 0 || charge.changed}
      footerLead={
        error ? (
          <FormErrorSummary message={error} />
        ) : tried && missing.length > 0 && available.length > 0 ? (
          <FormErrorSummary message={tf('orders.sourcesMissing', { count: formatNumber(missing.length) })} />
        ) : sms.preparing ? (
          <p className="text-xs text-muted-foreground">{t('orders.smsPreparing')}</p>
        ) : undefined
      }
      footer={
        noSources ? (
          <ModalCancel label={t('app.close')} />
        ) : (
          <>
            <ModalCancel label={t('app.dismiss')} disabled={busy} />
            <Button loading={busy} disabled={sources.isLoading || sms.preparing} onClick={submit}>
              {t('order.accept')}
            </Button>
          </>
        )
      }
    >
      {noSources ? (
        <EmptyState
          icon={MapPin}
          title={t('order.noSources')}
          action={
            <ButtonLink href="/owner/sources" size="sm">
              {t('nav.sources')}
            </ButtonLink>
          }
        />
      ) : sources.isLoading ? (
        // The selects would open empty; say the list is on its way instead.
        <div className="space-y-3" aria-busy="true" aria-label={t('orders.sourcesLoading')}>
          <p className="text-sm text-muted-foreground">{t('orders.sourcesLoading')}</p>
          {order.items.map((item) => (
            <Skeleton key={item.id} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">{t('order.sourceHelp')}</p>

          {sources.isError && available.length === 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink" role="alert">
              <span>{errorMessage(sources.error)}</span>
              <Button size="sm" variant="outline" loading={sources.isFetching} onClick={() => sources.refetch()}>
                {t('app.retry')}
              </Button>
            </div>
          )}

          {/* The shortcut, only worth showing when there is more than one line. */}
          {order.items.length > 1 && (
            <Field label={t('order.sameSourceAll')} htmlFor="source-all">
              <Select
                id="source-all"
                defaultValue=""
                onChange={(event) => setAll(event.target.value)}
              >
                <option value="">{t('order.chooseSource')}</option>
                {available.map((source) => (
                  <option key={source._id} value={source._id}>
                    {source.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {/*
           * One tinted block per line rather than a divider list.
           *
           * A product name, its quantity and a select stacked between hairlines
           * read as six loose things in a column; boxed, they read as three
           * decisions. It is the same information with room to breathe around it.
           */}
          <div className="space-y-3">
            {order.items.map((item) => {
              const value = chosenFor(item.id, item.product);
              const invalid = tried && !value;
              const guessed = picked[item.id] === undefined && Boolean(value);
              return (
                <div
                  key={item.id}
                  data-invalid={invalid || undefined}
                  className={cn('rounded-xl bg-muted/60 p-3.5', invalid && 'ring-2 ring-danger/40')}
                >
                  <p className="text-sm font-semibold">{item.productName}</p>
                  <p className="tabular mb-2.5 text-xs text-muted-foreground">{itemAmount(item)}</p>
                  <Select
                    aria-label={`${t('order.chooseSource')} · ${item.productName}`}
                    aria-invalid={invalid || undefined}
                    value={value}
                    onChange={(event) =>
                      setPicked((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  >
                    <option value="">{t('order.chooseSource')}</option>
                    {available.map((source) => (
                      <option key={source._id} value={source._id}>
                        {source.name}
                      </option>
                    ))}
                  </Select>
                  {guessed && (
                    <p className="mt-1.5 text-xs text-muted-foreground">{t('orders.sourceRemembered')}</p>
                  )}
                  {invalid && (
                    <p className="mt-1.5 text-xs font-medium text-danger">{t('order.sourceMissing')}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <DeliveryChargeField order={order} state={charge} id="accept-delivery-charge" className="mb-0" />
          </div>

          <CustomerSmsField state={sms} />
        </>
      )}
    </Modal>
  );
}

/**
 * Accepting several orders from one orchard. Collects the source and hands it
 * back; the list runs the accepts one at a time and shows the progress. Starts
 * on the orchard the selected products came from last time, when there is one.
 */
export function BulkAcceptModal({
  count,
  products,
  onClose,
  onConfirm,
}: {
  count: number;
  /** The products on the selected orders, for the remembered default. */
  products: string[];
  onClose: () => void;
  onConfirm: (sourceId: string) => void;
}) {
  const { sources, available } = useAvailableSources();
  const [remembered] = useState(readLastSources);
  const [picked, setPicked] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const guess = products
    .map((product) => remembered[product])
    .find((id) => id && available.some((source) => source._id === id));
  const value = picked ?? guess ?? '';

  return (
    <Modal
      open
      onClose={onClose}
      title={tf('orders.bulkAcceptTitle', { count: formatNumber(count) })}
      dirty={picked !== null}
      footer={
        <>
          <ModalCancel label={t('app.dismiss')} />
          <Button
            disabled={sources.isLoading}
            onClick={() => {
              setTried(true);
              if (value) onConfirm(value);
            }}
          >
            {tf('orders.bulkAcceptConfirm', { count: formatNumber(count) })}
          </Button>
        </>
      }
    >
      {sources.isSuccess && available.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title={t('order.noSources')}
          action={
            <ButtonLink href="/owner/sources" size="sm">
              {t('nav.sources')}
            </ButtonLink>
          }
        />
      ) : (
        <>
          <Field
            label={t('order.sameSourceAll')}
            htmlFor="bulk-source"
            required
            hint={sources.isLoading ? t('orders.sourcesLoading') : t('orders.bulkAcceptHint')}
            error={tried && !value ? t('order.sourceMissing') : undefined}
          >
            <Select
              id="bulk-source"
              value={value}
              disabled={sources.isLoading}
              aria-invalid={tried && !value ? true : undefined}
              onChange={(event) => setPicked(event.target.value)}
            >
              <option value="">{t('order.chooseSource')}</option>
              {available.map((source) => (
                <option key={source._id} value={source._id}>
                  {source.name}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
    </Modal>
  );
}
