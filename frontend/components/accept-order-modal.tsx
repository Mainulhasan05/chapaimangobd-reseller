'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatQuantity } from '@/lib/format';
import type { Order, Source } from '@/lib/types';
import { Alert, EmptyState } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { DeliveryChargeField, useDeliveryCharge } from '@/components/delivery-charge-field';
import { CustomerSmsField, useCustomerSms } from '@/components/customer-sms-field';
import { primeOrder } from '@/components/order-page';

/**
 * Accepting an order, which is where the owner says where each line comes from.
 *
 * A product is fixed and its orchard is not: which source a crate is collected
 * from depends on what is ripe and who has it on the day. So the choice belongs
 * here, at accept, rather than on the product form, and the API refuses an
 * accept that does not make it.
 *
 * Most orders come from one place, so the whole form is one select with a
 * per-line override underneath. Asking line by line first would make the common
 * case the slow one.
 */
export function AcceptOrderModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  // Keyed by line id, so a product appearing twice can still split across two
  // orchards. The order's own line ids are the only stable handle for that.
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const sources = useQuery({
    queryKey: ['owner', 'sources'],
    queryFn: () => api.get<{ sources: Source[] }>('/owner/sources'),
    enabled: Boolean(order),
  });

  const available = sources.data?.sources.filter((source) => !source.isArchived) ?? [];

  // Accept is often when the owner first learns what the courier will charge.
  const charge = useDeliveryCharge(order);

  // The optional message to the customer, previewed before it is committed to.
  const sms = useCustomerSms(order, 'accept');

  const accept = useMutation({
    mutationFn: async () => {
      // The charge first, so the accept that follows is taken against the final
      // figure. If the accept then fails, the charge change still stands, and
      // pressing the button again sends it as a no-op.
      await charge.apply();
      return api.post<{ order: Order }>(`/owner/orders/${order!.id}/accept`, {
        sources: order!.items.map((item) => ({ itemId: item.id, sourceId: chosen[item.id] })),
        sendCustomerSms: sms.enabled,
      });
    },
    onSuccess: async (data) => {
      primeOrder(queryClient, 'owner', data.order);
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      setChosen({});
      charge.reset();
      sms.reset();
      onClose();
      toast(t('order.acceptedToast'));
    },
    // A failure after the charge went through still changed the order.
    onError: () => queryClient.invalidateQueries({ queryKey: ['owner'] }),
  });

  if (!order) return null;

  const complete = order.items.every((item) => Boolean(chosen[item.id]));

  /** Fills every line at once, which is what most orders need. */
  const setAll = (sourceId: string) => {
    if (!sourceId) return;
    setChosen(Object.fromEntries(order.items.map((item) => [item.id, sourceId])));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('order.acceptTitle')} · ${order.orderCode}`}
      dirty={Object.keys(chosen).length > 0 || charge.changed}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={accept.isPending}
            disabled={!complete || available.length === 0 || !charge.check.ok || !sms.ready}
            onClick={() => accept.mutate()}
          >
            {t('order.accept')}
          </Button>
        </>
      }
    >
      {accept.error && <Alert tone="danger">{errorMessage(accept.error)}</Alert>}

      {sources.isSuccess && available.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title={t('order.noSources')}
          action={
            <Link href="/owner/sources">
              <Button size="sm">{t('nav.sources')}</Button>
            </Link>
          }
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">{t('order.sourceHelp')}</p>

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
            {order.items.map((item) => (
              <div key={item.id} className="rounded-xl bg-muted/60 p-3.5">
                <p className="text-sm font-semibold">{item.productName}</p>
                <p className="tabular mb-2.5 text-xs text-muted-foreground">
                  {formatQuantity(item.quantity, item.unit)}
                </p>
                <Select
                  aria-label={`${t('order.chooseSource')} · ${item.productName}`}
                  value={chosen[item.id] ?? ''}
                  onChange={(event) =>
                    setChosen((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                >
                  <option value="">{t('order.chooseSource')}</option>
                  {available.map((source) => (
                    <option key={source._id} value={source._id}>
                      {source.name}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>

          {!complete && (
            <p className="mt-4 text-xs text-muted-foreground">{t('order.sourceMissing')}</p>
          )}

          <div className="mt-5 border-t border-border pt-4">
            <DeliveryChargeField order={order} state={charge} id="accept-delivery-charge" className="mb-0" />
          </div>

          <CustomerSmsField state={sms} />
        </>
      )}
    </Modal>
  );
}
