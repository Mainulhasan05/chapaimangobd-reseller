'use client';

/**
 * The download control, and the list of what can be downloaded.
 *
 * One component rather than a button per page, because a report is only useful
 * if it is where the question was asked: the order sheet belongs above the
 * orders list, the due report above the receivables table. A person who has to
 * go to a reports screen and re-enter the dates they just chose will export the
 * whole history by accident, which is exactly what used to happen here.
 *
 * Every entry opens a printable page with `auto=1`, which fires the browser's
 * print dialog as soon as the data lands. That dialog is where "Save as PDF"
 * lives, on Android and on the desktop both, so the hint says so: the button
 * cannot put a file in Downloads by itself and should not pretend to.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ChevronDown, Download, FileText } from 'lucide-react';
import { t, type DictKey } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { rangeParams, type DateRange } from '@/components/ui/date-range';

export type ReportKind =
  | 'orders'
  | 'pick-list'
  | 'sales'
  | 'products'
  | 'resellers'
  | 'customers'
  | 'due';

const REPORTS: { kind: ReportKind; labelKey: DictKey; hintKey: DictKey; ranged: boolean }[] = [
  { kind: 'orders', labelKey: 'report.orderSheet', hintKey: 'report.orderSheetHint', ranged: true },
  { kind: 'pick-list', labelKey: 'report.pickList', hintKey: 'report.pickListHint', ranged: true },
  { kind: 'sales', labelKey: 'report.sales', hintKey: 'report.salesHint', ranged: true },
  { kind: 'products', labelKey: 'report.products', hintKey: 'report.productsHint', ranged: true },
  { kind: 'resellers', labelKey: 'report.resellers', hintKey: 'report.resellersHint', ranged: true },
  // A buyer's record spans every order they ever placed, so it takes no dates.
  { kind: 'customers', labelKey: 'report.customers', hintKey: 'report.customersHint', ranged: false },
  // A balance is where a wallet stands now, not over a period, so no dates.
  { kind: 'due', labelKey: 'report.due', hintKey: 'report.dueHint', ranged: false },
];

/** The href for one report, carrying the range and anything else it filters on. */
export function reportHref(
  kind: ReportKind,
  range: DateRange,
  extra?: Record<string, string | undefined>,
  auto = true
): Route {
  const ranged = REPORTS.find((report) => report.kind === kind)?.ranged ?? true;
  const params = [
    ranged ? rangeParams(range) : '',
    ...Object.entries(extra ?? {}).map(([key, value]) => (value ? `${key}=${value}` : '')),
    auto ? 'auto=1' : '',
  ].filter(Boolean);

  return `/owner/reports/print/${kind}${params.length ? `?${params.join('&')}` : ''}` as Route;
}

/**
 * A single download button, for a page that only has one report worth offering.
 *
 * Opens in this tab rather than a new one: a new tab on a phone is a tab the
 * person has to find their way out of afterwards, and the report's own bar has
 * a way back.
 */
export function ReportButton({
  kind,
  range,
  extra,
  label,
  variant = 'outline',
  className,
}: {
  kind: ReportKind;
  range: DateRange;
  extra?: Record<string, string | undefined>;
  label?: string;
  variant?: 'outline' | 'primary' | 'ghost';
  className?: string;
}) {
  return (
    <Link href={reportHref(kind, range, extra)} className={className}>
      <Button variant={variant} size="sm" title={t('report.downloadHint')}>
        <Download className="h-4 w-4" />
        {label ?? t('report.download')}
      </Button>
    </Link>
  );
}

/**
 * Every report, behind one button, with the current range already applied.
 *
 * A menu rather than a row of buttons: there are five, the labels are long in
 * Bengali, and a phone toolbar that wraps to three lines pushes the list itself
 * below the fold.
 */
export function DownloadMenu({
  range,
  only,
  extra,
  className,
}: {
  range: DateRange;
  /** Narrow the list, for a page where the others make no sense. */
  only?: ReportKind[];
  extra?: Record<string, string | undefined>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const items = only ? REPORTS.filter((report) => only.includes(report.kind)) : REPORTS;

  return (
    <div ref={wrap} className={cn('print-hide relative', className)}>
      <Button
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <Download className="h-4 w-4" />
        {t('report.download')}
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </Button>

      {open && (
        <div
          role="menu"
          className="menu-in absolute right-0 z-40 mt-1 w-[17rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface elev-2"
        >
          <p className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
            {t('report.pickChoose')}
          </p>

          {items.map((report) => (
            <Link
              key={report.kind}
              role="menuitem"
              href={reportHref(report.kind, range, extra)}
              onClick={() => setOpen(false)}
              className="flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted"
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t(report.labelKey)}</span>
                <span className="block text-xs text-muted-foreground">{t(report.hintKey)}</span>
              </span>
            </Link>
          ))}

          {/*
           * Said once, here, rather than on each button. The browser's print
           * sheet is where a PDF is actually saved, and someone meeting it for
           * the first time will not guess that.
           */}
          <p className="border-t border-border bg-muted/50 px-3 py-2 text-[0.6875rem] text-muted-foreground">
            {t('report.downloadHint')}
          </p>
        </div>
      )}
    </div>
  );
}
