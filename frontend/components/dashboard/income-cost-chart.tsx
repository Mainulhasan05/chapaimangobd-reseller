'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@/lib/i18n/bn';
import { formatDayShort, formatMoney, formatNumber } from '@/lib/format';
import { GRID, SERIES } from './chart-tokens';

export type DayMoney = { date: string; income: number; cost: number };

/**
 * An axis figure a person would say: whole taka under a thousand, then
 * "১২.৫ হাজার". The old labels were "12k", an English abbreviation in a
 * Bengali screen that most of its readers would not expand.
 */
function axisLabel(value: number): string {
  if (value < 1000) return formatNumber(Math.round(value));
  return `${formatNumber(Math.round(value / 100) / 10)} ${t('dash.thousand')}`;
}

/**
 * What came in against what the orders cost, a day at a time.
 *
 * Two series, so unlike `TrendChart` this one needs a legend — and bars rather
 * than lines, because the reader's question is "which day was worse" and that is
 * a comparison of two heights side by side, not a shape over time.
 *
 * Income is the brand colour and cost is a neutral: cost is the quantity being
 * read *against* income, not a second thing of equal standing, and giving it its
 * own hue would make the pair look like two categories instead of a figure and
 * its drag. The neutral also keeps the card to one hue family, which is the rule
 * the rest of the chart palette follows.
 *
 * The cost is the orders' own cost (goods, packaging, order expenses), never the
 * month's overheads, which belong to no day. The note under the legend says so,
 * because "খরচ" alone read as everything spent.
 *
 * Drawn by hand rather than with a charting library: seven pairs of rectangles do
 * not justify the weight, and rounded caps plus a per-day target are easier to
 * control directly than to configure.
 */
export function IncomeCostChart({ days, height = 220 }: { days: DayMoney[]; height?: number }) {
  const clipId = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  // Measured, not scaled. A stretched viewBox would give the rounded caps a
  // different radius on every screen width.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const padL = 58;
  const padB = 26;
  const padT = 10;
  const plotH = height - padB - padT;
  const plotW = Math.max(0, width - padL - 8);

  const peak = Math.max(1, ...days.map((d) => Math.max(d.income, d.cost)));
  // A round ceiling, so the gridline labels are numbers a person would say.
  const step = Math.pow(10, Math.floor(Math.log10(peak)));
  const ceiling = Math.ceil(peak / step) * step;

  const slot = days.length > 0 ? plotW / days.length : 0;
  const bw = Math.max(5, Math.min(16, slot * 0.26));
  const y = (v: number) => padT + plotH - (v / ceiling) * plotH;
  // Seven Bengali dates do not fit side by side on a phone; every other one
  // does, and today is always labelled.
  const sparseDates = slot < 46;

  const current = active != null ? days[active] : undefined;

  /*
   * The nearest day to the pointer, for mouse and finger alike. The pointer
   * events replaced per-bar mouse hovers, which a phone never fires, so the
   * chart could not be read at all on the device it is mostly opened on.
   */
  const pick = (event: React.PointerEvent<SVGSVGElement>) => {
    if (slot <= 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left - padL) / slot);
    setActive(index >= 0 && index < days.length ? index : null);
  };

  return (
    <div ref={wrapRef} className="relative w-full">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: SERIES }}
          />
          {t('dash.income')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-muted-foreground/45" />
          {t('dash.orderCost')}
        </span>
      </div>
      <p className="mb-2 text-[0.6875rem] text-muted-foreground">{t('dash.overheadsExcluded')}</p>

      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={t('dash.incomeVsSpend')}
          className="touch-pan-y"
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={(event) => {
            // A finger lifting is not leaving: keep the tapped day on screen.
            if (event.pointerType === 'mouse') setActive(null);
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={width} height={height} />
            </clipPath>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line
                x1={padL}
                y1={y(ceiling * f)}
                x2={width - 8}
                y2={y(ceiling * f)}
                stroke={GRID}
                strokeWidth={1}
                strokeDasharray={f === 0 ? undefined : '3 4'}
              />
              {/* Three labels, not five: on a phone five crowd the axis into a column of digits. */}
              {(f === 0 || f === 0.5 || f === 1) && (
                <text
                  x={padL - 8}
                  y={y(ceiling * f) + 4}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  style={{ fontSize: 10 }}
                >
                  {axisLabel(ceiling * f)}
                </text>
              )}
            </g>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {days.map((d, i) => {
              const cx = padL + slot * i + slot / 2;
              const dim = active != null && active !== i;
              const last = i === days.length - 1;
              const labelled = !sparseDates || last || (days.length - 1 - i) % 2 === 0;
              return (
                <g key={d.date} style={{ opacity: dim ? 0.4 : 1, transition: 'opacity 140ms' }}>
                  <rect
                    x={cx - bw - 2}
                    y={y(d.income)}
                    width={bw}
                    height={Math.max(0, padT + plotH - y(d.income))}
                    rx={bw / 2}
                    fill={SERIES}
                  />
                  <rect
                    x={cx + 2}
                    y={y(d.cost)}
                    width={bw}
                    height={Math.max(0, padT + plotH - y(d.cost))}
                    rx={bw / 2}
                    className="fill-muted-foreground/45"
                  />
                  {labelled && (
                    <text
                      x={cx}
                      y={height - 7}
                      textAnchor="middle"
                      className="fill-muted-foreground"
                      style={{ fontSize: 10.5 }}
                    >
                      {formatDayShort(d.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}

      {/*
       * The chosen day in words, under the plot rather than floating over it: a
       * tooltip that follows the pointer sits under the thumb on a phone, and a
       * fixed line is legible with the thumb still on the chart.
       */}
      <div className="mt-1 min-h-5 text-xs" aria-live="polite">
        {current ? (
          <span className="tabular">
            <span className="font-semibold">{formatDayShort(current.date)}</span>
            <span className="text-muted-foreground">
              {' · '}
              {t('dash.income')} {formatMoney(current.income)}
              {' · '}
              {t('dash.orderCost')} {formatMoney(current.cost)}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('dash.tapDay')}</span>
        )}
      </div>

      {/* Every value as text too: the chart enhances, it never gates. */}
      <details className="mt-2">
        <summary className="tap cursor-pointer text-xs font-semibold text-muted-foreground">
          {t('dash.dataTable')}
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr>
              <th className="py-1 text-left font-semibold text-muted-foreground">{t('dash.day')}</th>
              <th className="py-1 text-right font-semibold text-muted-foreground">{t('dash.income')}</th>
              <th className="py-1 text-right font-semibold text-muted-foreground">
                {t('dash.orderCost')}
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date} className="border-t border-border">
                <td className="py-1">{formatDayShort(day.date)}</td>
                <td className="tabular py-1 text-right">{formatMoney(day.income)}</td>
                <td className="tabular py-1 text-right">{formatMoney(day.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
