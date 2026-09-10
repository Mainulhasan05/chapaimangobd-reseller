'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@/lib/i18n/bn';
import { formatDayShort, formatMoney } from '@/lib/format';
import { GRID, SERIES } from './chart-tokens';

export type TrendPoint = { date: string; value: number };

/**
 * Daily earnings over a short window.
 *
 * One series, so there is no legend: the card's own heading says what is plotted,
 * and a box with a single swatch in it would only restate that. The endpoint and
 * the best day are labelled directly; every other value is reachable through the
 * crosshair and, without hovering at all, through the table underneath.
 *
 * Geometry is measured rather than scaled. A viewBox stretched to fit would give
 * the 2px stroke a different thickness on every screen and turn the end dot into
 * an ellipse.
 */
export function TrendChart({
  points,
  height = 120,
}: {
  points: TrendPoint[];
  height?: number;
}) {
  const gradientId = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const empty = points.every((point) => point.value === 0);

  // Room for the end dot and its surface ring on the right, and for the baseline.
  const padX = 10;
  const padY = 14;
  const innerW = Math.max(width - padX * 2, 1);
  const innerH = height - padY * 2;

  // The scale starts at zero. A trend axis that starts elsewhere exaggerates
  // every wobble into a story.
  const max = Math.max(...points.map((point) => point.value), 1);

  const x = (index: number) =>
    padX + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
  const y = (value: number) => padY + innerH - (value / max) * innerH;

  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
  const area = `${padX},${padY + innerH} ${line} ${x(points.length - 1)},${padY + innerH}`;

  const last = points[points.length - 1];
  const bestIndex = points.reduce(
    (best, point, index) => (point.value > points[best].value ? index : best),
    0
  );

  const shown = active === null ? null : points[active];

  return (
    <div>
      <div ref={wrapRef} className="relative">
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={t('dash.earnings')}
            className="touch-pan-y"
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const local = event.clientX - box.left;
              // Nearest point, so the reader aims at a day rather than at a 2px line.
              const step = innerW / Math.max(points.length - 1, 1);
              const index = Math.round((local - padX) / step);
              setActive(Math.min(Math.max(index, 0), points.length - 1));
            }}
            onPointerLeave={() => setActive(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                {/* A wash, never a saturated block. */}
                <stop offset="0%" stopColor={SERIES} stopOpacity="0.22" />
                <stop offset="100%" stopColor={SERIES} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Baseline only. Hairline, solid, one step off the surface. */}
            <line
              x1={padX}
              y1={padY + innerH}
              x2={padX + innerW}
              y2={padY + innerH}
              stroke={GRID}
              strokeWidth="1"
            />

            {!empty && (
              <>
                <polygon points={area} fill={`url(#${gradientId})`} />
                <polyline
                  points={line}
                  fill="none"
                  stroke={SERIES}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* The crosshair, drawn under the marks it explains. */}
                {shown && (
                  <>
                    <line
                      x1={x(active!)}
                      y1={padY - 6}
                      x2={x(active!)}
                      y2={padY + innerH}
                      stroke={GRID}
                      strokeWidth="1"
                    />
                    <circle
                      cx={x(active!)}
                      cy={y(shown.value)}
                      r="5"
                      fill={SERIES}
                      stroke="var(--surface)"
                      strokeWidth="2"
                    />
                  </>
                )}

                {/* The endpoint keeps its dot even when nothing is hovered. */}
                <circle
                  cx={x(points.length - 1)}
                  cy={y(last.value)}
                  r="4.5"
                  fill={SERIES}
                  stroke="var(--surface)"
                  strokeWidth="2"
                />
              </>
            )}
          </svg>
        )}

        {empty && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {t('dash.noActivity')}
          </p>
        )}

        {/* Value leads, label follows: the reader already knows the series. */}
        {shown && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-lg bg-foreground px-2 py-1 text-center shadow-md"
            style={{ left: Math.min(Math.max(x(active!), 44), width - 44) }}
          >
            <span className="tabular block text-xs font-bold text-background">
              {formatMoney(shown.value)}
            </span>
            <span className="block text-[0.625rem] text-background/70">
              {formatDayShort(shown.date)}
            </span>
          </div>
        )}
      </div>

      {/* Sparing direct labels: the first day, the best day, and today. */}
      <div className="mt-1 flex justify-between text-[0.6875rem] text-muted-foreground">
        <span>{formatDayShort(points[0].date)}</span>
        {!empty && bestIndex !== 0 && bestIndex !== points.length - 1 && (
          <span className="font-semibold text-foreground">
            {t('dash.busiestDay')} {formatMoney(points[bestIndex].value)}
          </span>
        )}
        <span>{formatDayShort(last.date)}</span>
      </div>

      {/*
       * The tooltip enhances, it never gates. Every value in the chart is also
       * here, reachable by a screen reader and by anyone who cannot hover.
       */}
      <details className="mt-3">
        <summary className="tap cursor-pointer text-xs font-semibold text-muted-foreground">
          {t('dash.dataTable')}
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr>
              <th className="py-1 text-left font-semibold text-muted-foreground">{t('dash.day')}</th>
              <th className="py-1 text-right font-semibold text-muted-foreground">
                {t('dash.earnings')}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date} className="border-t border-border">
                <td className="py-1">{formatDayShort(point.date)}</td>
                <td className="tabular py-1 text-right">{formatMoney(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
