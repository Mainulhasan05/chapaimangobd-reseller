'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/form';

export type ConfirmRow = {
  label: string;
  value: React.ReactNode;
  /** Colours the value when the change is the point: a balance going negative. */
  tone?: 'danger' | 'success' | 'warning';
  strong?: boolean;
};

/**
 * The one way a money or irreversible action is confirmed.
 *
 * Approving a deposit, marking an order delivered, posting a manual ledger
 * entry and archiving a payee all used to happen on a single tap, next to other
 * buttons, with nothing on screen saying what would change. Each of them now
 * opens this sheet, which names the record, shows the numbers before and after,
 * says what else happens, and puts the action behind a verb that names it
 * ("৳৫,০০০ অনুমোদন করুন"), beside a dismiss that never shares its word.
 *
 * It stays open until the request answers, so a failure is shown here, next to
 * the button that caused it, rather than at the top of a scrolled list.
 *
 * Mount it only while it is open (`{target && <ConfirmSheet … />}`): the reason
 * typed for one request must never carry over to the next.
 */
export function ConfirmSheet({
  title,
  onClose,
  onConfirm,
  confirmLabel,
  tone = 'primary',
  summary,
  rows,
  consequences,
  reason,
  children,
  dismissLabel,
}: {
  title: string;
  onClose: () => void;
  /** Resolves when the action is done; a rejection is shown inline. */
  onConfirm: (reason: string) => Promise<unknown>;
  confirmLabel: string;
  tone?: 'primary' | 'danger' | 'success';
  /** Who and what: the shop, the order code, the amount. */
  summary?: React.ReactNode;
  /** The numbers the decision rests on, typically before → after. */
  rows?: ConfirmRow[];
  /** What else happens, one plain sentence each. */
  consequences?: string[];
  reason?: {
    required?: boolean;
    label?: string;
    placeholder?: string;
    /** One tap fills the field; the owner may still edit it. */
    presets?: string[];
    minLength?: number;
  };
  /** Anything else the decision needs to see, such as a payment screenshot. */
  children?: React.ReactNode;
  dismissLabel?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const minLength = reason?.required ? (reason.minLength ?? 3) : 0;
  const reasonMissing = Boolean(reason?.required) && text.trim().length < minLength;

  const submit = async () => {
    setTried(true);
    if (reasonMissing) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={title}
      dirty={Boolean(text.trim())}
      footerLead={
        error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">
            {error}
          </p>
        ) : undefined
      }
      footer={
        <>
          <ModalCancel label={dismissLabel ?? t('app.dismiss')} disabled={busy} />
          <Button variant={tone} loading={busy} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {summary && <div className="mb-4 rounded-xl bg-muted px-4 py-3 text-sm">{summary}</div>}

      {rows && rows.length > 0 && (
        <dl className="mb-4 divide-y divide-border rounded-xl border border-border">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd
                className={cn(
                  'tabular text-right',
                  row.strong && 'font-semibold',
                  row.tone === 'danger' && 'font-semibold text-danger',
                  row.tone === 'success' && 'font-semibold text-success',
                  row.tone === 'warning' && 'font-semibold text-warning-ink'
                )}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {consequences && consequences.length > 0 && (
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {children}

      {reason && (
        <div className="mt-2">
          <label htmlFor="confirm-reason" className="mb-1.5 block text-[0.8125rem] font-semibold">
            {reason.label ?? t('app.reason')}
            {reason.required ? (
              <span className="ml-0.5 text-danger">*</span>
            ) : (
              <span className="ml-1 font-normal text-muted-foreground">({t('app.optional')})</span>
            )}
          </label>
          {reason.presets && reason.presets.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {reason.presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setText(preset)}
                  className={cn(
                    'min-h-11 rounded-full border px-3 text-sm transition-colors sm:min-h-9',
                    text === preset
                      ? 'border-primary bg-primary-softer font-semibold text-primary-ink'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
          )}
          <Textarea
            id="confirm-reason"
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={reason.placeholder}
            aria-invalid={tried && reasonMissing ? true : undefined}
          />
          {tried && reasonMissing ? (
            <p className="mt-1.5 text-xs font-medium text-danger">
              {tf('app.minChars', { count: formatNumber(minLength) })}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
