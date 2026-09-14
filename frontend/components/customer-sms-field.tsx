'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { useDebounced } from '@/lib/use-debounced';
import type { CustomerSmsAction, CustomerSmsPreview, Order } from '@/lib/types';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/button';

/**
 * The owner's "send SMS to customer" box on accept, ship and cancel.
 *
 * Off by default, every time the sheet opens (docs/adr/0013). When on, the text
 * the customer would receive is fetched from the server and shown verbatim, with
 * what it costs, and re-fetched as the courier, tracking number or reason
 * changes. The server renders the queued message with the same function from
 * the same inputs, so what is shown here is what is sent.
 *
 * `ready` is false while typing has not settled or a preview is on its way, so
 * the modal can hold its submit button until the text on screen is current.
 */
export function useCustomerSms(
  order: Order | null,
  action: CustomerSmsAction,
  inputs: { courier?: string; trackingId?: string; reason?: string } = {}
) {
  const [enabled, setEnabled] = useState(false);

  // Back to off whenever the sheet is opened for another order, or closed. The
  // modals stay mounted between orders, so state alone would carry a tick over.
  const orderId = order?.id ?? null;
  const [seenOrder, setSeenOrder] = useState(orderId);
  if (seenOrder !== orderId) {
    setSeenOrder(orderId);
    setEnabled(false);
  }

  // A string, so the debounce compares values rather than a fresh object per render.
  const current = new URLSearchParams({
    action,
    ...(action === 'ship' ? { courier: inputs.courier ?? '', trackingId: inputs.trackingId ?? '' } : {}),
    ...(action === 'cancel' ? { reason: inputs.reason ?? '' } : {}),
  }).toString();
  const settled = useDebounced(current, 400);

  // Until the box is ticked only availability matters, so the inputs stay out of
  // the key and typing costs no requests.
  const query = enabled ? settled : new URLSearchParams({ action }).toString();

  const preview = useQuery({
    queryKey: ['owner', 'customer-sms-preview', order?.id, query],
    queryFn: ({ signal }) =>
      api.get<CustomerSmsPreview>(`/owner/orders/${order!.id}/customer-sms-preview?${query}`, signal),
    enabled: Boolean(order),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });

  const available = preview.data?.available === true;
  const sending = enabled && available;
  const ready = !sending || (settled === current && !preview.isFetching && preview.isSuccess);

  return {
    enabled: sending,
    setEnabled,
    available,
    preview,
    ready,
    reset: () => setEnabled(false),
  };
}

export type CustomerSmsState = ReturnType<typeof useCustomerSms>;

export function CustomerSmsField({ state }: { state: CustomerSmsState }) {
  const { preview, available } = state;
  const loadingAvailability = preview.isLoading;

  return (
    <div className="mt-5 border-t border-border pt-4">
      <Switch
        checked={state.enabled}
        disabled={!available}
        onChange={state.setEnabled}
        label={t('customerSms.send')}
        hint={
          loadingAvailability
            ? t('customerSms.loading')
            : available
              ? t('customerSms.sendHint')
              : preview.isError
                ? errorMessage(preview.error)
                : t('customerSms.unavailable')
        }
      />

      {state.enabled && (
        <div className="mt-3 rounded-xl bg-muted/60 p-3.5" aria-live="polite">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MessageSquareText aria-hidden className="h-3.5 w-3.5" />
            {t('customerSms.preview')}
            {preview.isFetching && <Spinner className="h-3 w-3" />}
          </p>

          {preview.data && (
            <>
              {/* Latin text, shown exactly as it will arrive, line breaks and all. */}
              <p lang="en" className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {preview.data.text}
              </p>
              <p className="tabular mt-2 text-xs text-muted-foreground">
                {formatNumber(preview.data.chars)} {t('customerSms.chars')} ·{' '}
                {formatNumber(preview.data.segments)} {t('customerSms.segments')}
                {preview.data.phone && (
                  <>
                    {' · '}
                    {t('customerSms.to')} <span lang="en">{preview.data.phone}</span>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
