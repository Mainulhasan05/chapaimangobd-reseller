'use client';

import { useState } from 'react';
import { t, tStatus } from '@/lib/i18n/bn';
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
 * colour alone, and a stage too thin to see still has its number.
 */
export function PipelineBar({ byStatus }: { byStatus: Partial<Record<OrderStatus, number>> }) {
  const [active, setActive] = useState<string | null>(null);

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

  return (
    <div>
      {/*
       * `gap-0.5` is the 2px surface gap doing the separating. Neighbouring steps
       * on one ramp read as distinct because of the gap, not because of a stroke
       * drawn around them.
       */}
      <div className="flex h-8 gap-0.5 overflow-hidden rounded-lg">
        {present.map((row) => (
          <button
            key={row.stage}
            type="button"
            // The mark is the hit target on a bar; no crosshair.
            onPointerEnter={() => setActive(row.stage)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(row.stage)}
            onBlur={() => setActive(null)}
            aria-label={`${row.label}: ${formatNumber(row.count)}`}
            className="min-w-1 transition-[filter] first:rounded-l-lg last:rounded-r-lg"
            style={{
              width: `${(row.count / total) * 100}%`,
              background: row.color,
              filter: active === row.stage ? 'brightness(1.12)' : undefined,
            }}
          />
        ))}
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {rows.map((row) => (
          <li
            key={row.stage}
            className={`flex items-center gap-2 text-xs transition-opacity ${
              active && active !== row.stage ? 'opacity-50' : ''
            }`}
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: row.color }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.label}</span>
            <span className="tabular font-bold">{formatNumber(row.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
