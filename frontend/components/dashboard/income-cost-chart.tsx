'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@/lib/i18n/bn';
import { formatDayShort, formatMoney, formatNumber } from '@/lib/format';
import { GRID, SERIES } from './chart-tokens';

export type DayMoney = { date: string; income: number; cost: number };

/**
 * What came in against what went out, a day at a time.
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
 * Drawn by hand rather than with a charting library: seven pairs of rectangles do
 * not justify the weight, and rounded caps plus a per-day hover group are easier
 * to control directly than to configure.
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

  const padL = 44;
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

  const current = active != null ? days[active] : undefined;

  return (
    <div ref={wrapRef} className="relative w-full">
      <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
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
          {t('dash.spend')}
        </span>
      </div>

      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={t('dash.incomeVsSpend')}
          onMouseLeave={() => setActive(null)}
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
              <text
                x={padL - 8}
                y={y(ceiling * f) + 4}
                textAnchor="end"
                className="fill-muted-foreground"
                style={{ fontSize: 10 }}
              >
                {f === 0 ? formatNumber(0) : `${formatNumber(Math.round((ceiling * f) / 1000))}k`}
              </text>
            </g>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {days.map((d, i) => {
              const cx = padL + slot * i + slot / 2;
              const dim = active != null && active !== i;
              return (
                <g
                  key={d.date}
                  onMouseEnter={() => setActive(i)}
                  style={{ opacity: dim ? 0.4 : 1, transition: 'opacity 140ms' }}
                >
                  {/* A full-height target, so the pair is hoverable from the gap too. */}
                  <rect
                    x={padL + slot * i}
                    y={padT}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                  />
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
                  <text
                    x={cx}
                    y={height - 7}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    style={{ fontSize: 10.5 }}
                  >
                    {formatDayShort(d.date)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}

      {/*
       * The hovered day in words, under the plot rather than floating over it: a
       * tooltip that follows the pointer is unreachable on the phone this app is
       * mostly read on, and a fixed line is legible with a thumb over the chart.
       */}
      <div className="mt-1 min-h-5 text-xs">
        {current ? (
          <span className="tabular">
            <span className="font-semibold">{formatDayShort(current.date)}</span>
            <span className="text-muted-foreground">
              {' · '}
              {t('dash.income')} {formatMoney(current.income)}
              {' · '}
              {t('dash.spend')} {formatMoney(current.cost)}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('dash.hoverDay')}</span>
        )}
      </div>
    </div>
  );
}
