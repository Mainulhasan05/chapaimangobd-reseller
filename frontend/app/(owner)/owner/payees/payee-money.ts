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
