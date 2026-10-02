'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { ChevronRight } from 'lucide-react';
import { t, tf, tStatus } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import type { OrderStatus } from '@/lib/types';
import { PIPELINE_STAGES, RAMP } from './chart-tokens';

/**
 * Where the orders in flight currently sit, as one part-to-whole bar.
 *
 * The stages are a progression rather than a set of identities, so they are
 * painted on a single-hue ramp, light to dark, in the order an order actually
 * travels. Reaching for five unrelated hues here would say the stages are
 * unrelated categories, which is the opposite of what a pipeline is.
 *
 * Every segment is also a labelled row underneath, so identity never rests on
 * colour alone, and a stage too thin to see still has its number. The rows are
 * the controls: each opens the orders list at that stage. The segments used to
 * be buttons that did nothing but brighten, which a keyboard stopped on and a
 * screen reader announced as something to press; the bar is now one picture
 * with one description.
 */
export function PipelineBar({
  byStatus,
  hrefFor,
}: {
  byStatus: Partial<Record<OrderStatus, number>>;
  /** Where a stage's row leads, normally the orders list filtered to it. */
  hrefFor: (stage: OrderStatus) => Route;
}) {
  const rows = PIPELINE_STAGES.map((stage, index) => ({
    stage,
    label: tStatus(stage),
    count: byStatus[stage] ?? 0,
    color: RAMP[index],
  }));

  const total = rows.reduce((sum, row) => sum + row.count, 0);

  if (total === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t('dash.pipelineEmpty')}</p>;
  }

  const present = rows.filter((row) => row.count > 0);
  const summary = present.map((row) => `${row.label} ${formatNumber(row.count)}`).join(', ');

  return (
    <div>
      {/*
       * `gap-0.5` is the 2px surface gap doing the separating. Neighbouring steps
       * on one ramp read as distinct because of the gap, not because of a stroke
       * drawn around them.
       */}
      <div
        role="img"
        aria-label={tf('dash.inFlightLabel', { summary })}
        className="flex h-8 gap-0.5 overflow-hidden rounded-lg"
      >
        {present.map((row) => (
          <span
            key={row.stage}
            className="min-w-1 first:rounded-l-lg last:rounded-r-lg"
            style={{ width: `${(row.count / total) * 100}%`, background: row.color }}
          />
        ))}
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
        {rows.map((row) => (
          <li key={row.stage}>
            <Link
              href={hrefFor(row.stage)}
              className="-mx-2 flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm transition-colors hover:bg-muted"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: row.color }}
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.label}</span>
              <span className="tabular font-bold">{formatNumber(row.count)}</span>
              <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
