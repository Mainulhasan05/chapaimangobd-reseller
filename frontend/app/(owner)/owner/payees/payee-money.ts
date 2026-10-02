import { ApiError, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney } from '@/lib/format';

/**
 * Where an account stands, in words rather than in a sign.
 *
 * `due` is positive when the owner owes (docs/adr/0025), the opposite of a
 * reseller's balance. Zero and a due both read as "দিতে হবে"; a negative due is
 * not that sentence with a minus in it, so it gets the advance wording and a
 * different ink, and the two can never be mistaken for one another.
 */
export function payeeState(due: number): {
  label: string;
  value: string;
  hint: string;
  tone: 'warning' | 'primary' | 'neutral';
  ink: string;
} {
  if (due < 0) {
    return {
      label: t('payee.advance'),
      value: formatMoney(-due),
      hint: t('payee.advanceHint'),
      tone: 'primary',
      ink: 'text-primary-ink',
    };
  }
  return {
    label: t('payee.due'),
    value: formatMoney(due),
    hint: t('payee.dueHint'),
    tone: due > 0 ? 'warning' : 'neutral',
    ink: due > 0 ? 'text-warning-ink' : 'text-muted-foreground',
  };
}

/** A running figure on a ledger row or a preview, which may have crossed into advance. */
export function runningText(dueAfter: number): string {
  return dueAfter < 0
    ? `${t('payee.advance')} ${formatMoney(-dueAfter)}`
    : `${t('payee.dueAfter')} ${formatMoney(dueAfter)}`;
}

/**
 * The key a payment or hand entry is sent under.
 *
 * One key per opening of a sheet, so a double tap or a retry after a timeout
 * that actually went through is refused rather than posted twice. But a retry
 * with a different amount (or kind, or date) is a different entry, and the API
 * refuses a known key with new contents (NONCE_REUSED), so the key is renewed
 * whenever what is being sent changes.
 */
export function nonceFor(sent: { current: { key: string; nonce: string } | null }, payload: unknown): string {
  const key = JSON.stringify(payload);
  if (!sent.current || sent.current.key !== key) {
    sent.current = { key, nonce: crypto.randomUUID() };
  }
  return sent.current.nonce;
}

/** A failed payment or entry in words, including the refusal of a reused key. */
export function entryErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'NONCE_REUSED') return t('payee.nonceReused');
  return errorMessage(error);
}
