'use client';

import { Minus, Plus } from 'lucide-react';
import { t, tUnit } from '@/lib/i18n/bn';

/*
 * Quantity entry that does not summon the keyboard.
 *
 * A bare number input on a phone opens the keypad, which covers the very total
 * the customer is trying to watch change. Most orders move by one step, so the
 * two buttons carry the common case and the field stays for the rest.
 *
 * The minimum is enforced here rather than printed as help text and checked by
 * the server. Learning about a minimum from a rejected submission is learning it
 * in the worst possible place.
 */
export function QuantityStepper({
  value,
  onChange,
  step = 1,
  min = 1,
  unit,
  suffix,
  disabled,
  id,
}: {
  value: number;
  onChange: (value: number) => void;
  /** Defaults to whole units, which is what a count of boxes is. */
  step?: number;
  min?: number;
  /** A domain unit, translated here. Omit when `suffix` says it instead. */
  unit?: string;
  /** Already-readable text to the right, such as a box's own name. */
  suffix?: string;
  disabled?: boolean;
  id?: string;
}) {
  // Steps and minimums are decimals, so arithmetic on them drifts. Rounding to
  // three places matches qtyMilli, which is the precision the API stores.
  const round = (n: number) => Math.round(n * 1000) / 1000;

  const decrease = () => {
    const next = round(value - step);
    // Below the minimum there is only one legal quantity, which is none.
    onChange(next < min ? 0 : next);
  };

  const increase = () => onChange(value <= 0 ? min : round(value + step));

  return (
    <div className="flex items-center gap-2">
      <div className="control flex items-center">
        <button
          type="button"
          onClick={decrease}
          disabled={disabled || value <= 0}
          aria-label={t('catalog.decrease')}
          className="tap flex items-center justify-center rounded-l-[0.65rem] text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Minus className="h-4 w-4" />
        </button>

        <input
          id={id}
          type="number"
          inputMode="decimal"
          className="tabular h-11 w-16 border-x border-input bg-transparent text-center text-base font-semibold outline-none"
          step={step}
          min={0}
          value={value || ''}
          placeholder="0"
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
          onBlur={(event) => {
            // Typed values are corrected on blur rather than on every keystroke,
            // which would fight anyone typing a number that starts small.
            const typed = Number(event.target.value) || 0;
            if (typed > 0 && typed < min) onChange(min);
          }}
        />

        <button
          type="button"
          onClick={increase}
          disabled={disabled}
          aria-label={t('catalog.increase')}
          className="tap flex items-center justify-center rounded-r-[0.65rem] text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/*
       * Translated at the point of display, not by the caller. The prop is the
       * domain value the server validates against, so every call site passing
       * `product.unit` stays correct and none of them has to remember this.
       */}
      <span className="text-sm text-muted-foreground">{suffix ?? (unit ? tUnit(unit) : null)}</span>
    </div>
  );
}
