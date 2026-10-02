'use client';

import { useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query/react';
import { MessageSquareText } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { useDebounced } from '@/lib/use-debounced';
import {
  useGetCustomerSmsPreviewQuery,
  type CustomerSmsPreviewArgs,
} from '@/lib/store/endpoints/orders';
import type { CustomerSmsAction, Order } from '@/lib/types';
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
 *
 * The sheets that use this mount only while open, so the tick starts off for
 * every order without having to be reset by hand.
 */
export function useCustomerSms(
  order: Order | null,
  action: CustomerSmsAction,
  inputs: { courier?: string; trackingId?: string; reason?: string } = {}
) {
  const [enabled, setEnabled] = useState(false);

  // A string, so the debounce compares values rather than a fresh object per render.
  const current = JSON.stringify(
    action === 'ship'
      ? { courier: inputs.courier ?? '', trackingId: inputs.trackingId ?? '' }
      : action === 'cancel'
        ? { reason: inputs.reason ?? '' }
        : {}
  );
  const settled = useDebounced(current, 400);

  // Until the box is ticked only availability matters, so the inputs stay out of
  // the request and typing costs nothing.
  const arg: CustomerSmsPreviewArgs | typeof skipToken = order
    ? {
        id: order.id,
        action,
        ...(enabled
          ? (JSON.parse(settled) as Pick<CustomerSmsPreviewArgs, 'courier' | 'trackingId' | 'reason'>)
          : {}),
      }
    : skipToken;

  // `data` rather than `currentData`: the last preview stays on screen while the
  // next one is fetched, so the text does not blink away on every keystroke.
  const preview = useGetCustomerSmsPreviewQuery(arg);

  const available = preview.data?.available === true;
  /*
   * A preview that failed to load means the text is unknown, and an unknown text
   * is never sent. Treated as "no SMS" rather than as a wait: the old sheet held
   * its button spinning for ever when the preview errored. The field says so and
   * offers a retry; the order action itself goes ahead.
   */
  const failed = enabled && preview.isError;
  const sending = enabled && available && !failed;
  const ready = !sending || (settled === current && !preview.isFetching && preview.isSuccess);

  return {
    enabled: sending,
    setEnabled,
    available,
    failed,
    preview,
    ready,
    /** The text on screen is catching up with what was typed; the sheet says so. */
    preparing: !ready,
    reset: () => setEnabled(false),
  };
}

export type CustomerSmsState = ReturnType<typeof useCustomerSms>;

/** Why the box is off, in words the owner can act on. */
function unavailableText(state: CustomerSmsState): string {
  const { preview } = state;
  if (preview.isLoading) return t('customerSms.loading');
  if (preview.isError) return `${errorMessage(preview.error)} ${t('orders.smsWillNotSend')}`;
  switch (preview.data?.unavailableReason) {
    case 'not_configured':
      return t('orders.smsNotConfigured');
    case 'no_phone':
      return t('orders.smsNoPhone');
    default:
      return t('customerSms.unavailable');
  }
}

export function CustomerSmsField({ state }: { state: CustomerSmsState }) {
  const { preview, available, failed } = state;
  const data = preview.data;

  return (
    <div className="mt-5 border-t border-border pt-4">
      <Switch
        checked={state.enabled}
        disabled={!available && !failed}
        onChange={state.setEnabled}
        label={t('customerSms.send')}
        hint={available && !preview.isError ? t('customerSms.sendHint') : unavailableText(state)}
      />

      {preview.isError && (
        <button
          type="button"
          onClick={() => preview.refetch()}
          className="tap -mt-1 rounded-lg px-2 text-sm font-semibold text-primary-ink hover:bg-primary-softer"
        >
          {t('app.retry')}
        </button>
      )}

      {state.enabled && (
        <div className="mt-3 rounded-xl bg-muted/60 p-3.5" aria-live="polite">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MessageSquareText aria-hidden className="h-3.5 w-3.5" />
            {t('customerSms.preview')}
            {preview.isFetching && <Spinner className="h-3 w-3" />}
          </p>

          {data && (
            <>
              {/* Latin text, shown exactly as it will arrive, line breaks and all. */}
              <p lang="en" className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {data.text}
              </p>
              <p className="tabular mt-2 text-xs text-muted-foreground">
                {formatNumber(data.chars)} {t('customerSms.chars')} ·{' '}
                {formatNumber(data.segments)} {t('customerSms.segments')}
                {data.cost != null && (
                  <>
                    {' · '}
                    {tf('orders.smsCost', { amount: formatMoney(data.cost) })}
                  </>
                )}
                {data.phone && (
                  <>
                    {' · '}
                    {t('customerSms.to')} <span lang="en">{data.phone}</span>
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
