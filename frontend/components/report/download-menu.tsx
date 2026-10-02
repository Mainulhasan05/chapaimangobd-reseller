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
 * Every entry here opens a printable page with `auto=1`, which fires the
 * browser's print dialog as soon as the data lands: pressing "download" is an
 * explicit request to print. That dialog is where "Save as PDF" lives, on
 * Android and on the desktop both, so the hint says so: the button cannot put a
 * file in Downloads by itself and should not pretend to. The cards on the
 * reports screen open the same sheets without `auto`, to read first.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  Boxes,
  ChartColumn,
  ChevronDown,
  ClipboardList,
  Contact,
  Download,
  FileSpreadsheet,
  HandCoins,
  ListChecks,
  Package,
  Receipt,
  ShoppingCart,
  Store,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { t, tf, type DictKey } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';
import { exportHref, type ExportFile } from '@/lib/store/endpoints/reports';
import { Button, ButtonLink } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import type { DateRange, PresetKey } from '@/components/ui/date-range';

export type ReportKind =
  | 'orders'
  | 'pick-list'
  | 'sales'
  | 'products'
  | 'sources'
  | 'resellers'
  | 'customers'
  | 'due'
  // The cost side. See docs/PLAN-3.md.
  | 'supplies'
  | 'purchases'
  | 'payables'
  | 'expenses'
  | 'profit';

export type ReportGroup = 'sales' | 'people' | 'cost';

export type ReportInfo = {
  kind: ReportKind;
  labelKey: DictKey;
  hintKey: DictKey;
  /** Covers a range of days. The rest are a snapshot of where things stand now. */
  ranged: boolean;
  group: ReportGroup;
  icon: LucideIcon;
};

/*
 * The same icons the sidebar uses for the screen each report belongs to, so a
 * report is recognisable from the place it is about.
 */
export const REPORTS: ReportInfo[] = [
  {
    kind: 'orders',
    labelKey: 'report.orderSheet',
    hintKey: 'report.orderSheetHint',
    ranged: true,
    group: 'sales',
    icon: ClipboardList,
  },
  {
    kind: 'pick-list',
    labelKey: 'report.pickList',
    hintKey: 'report.pickListHint',
    ranged: true,
    group: 'sales',
    icon: ListChecks,
  },
  {
    kind: 'sales',
    labelKey: 'report.sales',
    hintKey: 'report.salesHint',
    ranged: true,
    group: 'sales',
    icon: TrendingUp,
  },
  {
    kind: 'products',
    labelKey: 'report.products',
    hintKey: 'report.productsHint',
    ranged: true,
    group: 'sales',
    icon: Package,
  },
  {
    kind: 'resellers',
    labelKey: 'report.resellers',
    hintKey: 'report.resellersHint',
    ranged: true,
    group: 'people',
    icon: Users,
  },
  // A balance is where a wallet stands now, not over a period, so no dates.
  {
    kind: 'due',
    labelKey: 'report.due',
    hintKey: 'report.dueHint',
    ranged: false,
    group: 'people',
    icon: Wallet,
  },
  // A buyer's record spans every order they ever placed, so it takes no dates.
  {
    kind: 'customers',
    labelKey: 'report.customers',
    hintKey: 'report.customersHint',
    ranged: false,
    group: 'people',
    icon: Contact,
  },
  // Which orchard to stop buying from. See backend models/Complaint.js.
  {
    kind: 'sources',
    labelKey: 'report.sources',
    hintKey: 'report.sourcesHint',
    ranged: true,
    group: 'people',
    icon: Store,
  },
  /*
   * The cost side. `profit` is the one this whole plan exists for; the rest feed
   * it. `payables` takes no dates for exactly the reason `due` does not — a due is
   * where an account stands at the moment it is printed.
   */
  {
    kind: 'profit',
    labelKey: 'report.profit',
    hintKey: 'report.profitHint',
    ranged: true,
    group: 'cost',
    icon: ChartColumn,
  },
  {
    kind: 'purchases',
    labelKey: 'report.purchases',
    hintKey: 'report.purchasesHint',
    ranged: true,
    group: 'cost',
    icon: ShoppingCart,
  },
  {
    kind: 'expenses',
    labelKey: 'report.expenses',
    hintKey: 'report.expensesHint',
    ranged: true,
    group: 'cost',
    icon: Receipt,
  },
  {
    kind: 'supplies',
    labelKey: 'report.supplies',
    hintKey: 'report.suppliesHint',
    ranged: true,
    group: 'cost',
    icon: Boxes,
  },
  {
    kind: 'payables',
    labelKey: 'report.payables',
    hintKey: 'report.payablesHint',
    ranged: false,
    group: 'cost',
    icon: HandCoins,
  },
];

export type ReportLinkOptions = {
  /** Filters the sheet honours beyond the dates: a status, a payee, a category. */
  extra?: Record<string, string | undefined>;
  /** Print as soon as the data lands. Off for a preview. */
  auto?: boolean;
  /**
   * The preset the screen is on. Sent by name, so "this month" opened next
   * month still means this month and the sheet's own chips light up the same one.
   */
  preset?: PresetKey | 'custom';
};

/**
 * The href for one report, carrying the range and anything else it filters on.
 *
 * No range and no preset sends no dates at all, which each sheet reads as its
 * own default: all time, or today for the collection list.
 */
export function reportHref(kind: ReportKind, range: DateRange, options: ReportLinkOptions = {}): Route {
  const { extra, auto = true, preset } = options;
  const ranged = REPORTS.find((report) => report.kind === kind)?.ranged ?? true;
  const params = new URLSearchParams();

  if (ranged) {
    if (preset && preset !== 'custom') {
      params.set('range', preset);
    } else if (range) {
      params.set('range', 'custom');
      params.set('from', range.from);
      params.set('to', range.to);
    }
  }
  Object.entries(extra ?? {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  if (auto) params.set('auto', '1');

  const query = params.toString();
  return `/owner/reports/print/${kind}${query ? `?${query}` : ''}` as Route;
}

/**
 * A single download button, for a page that only has one report worth offering.
 *
 * Opens in this tab rather than a new one: a new tab on a phone is a tab the
 * person has to find their way out of afterwards, and the report's own bar has
 * a way back.
 *
 * One link drawn as a button, not a link around a button. `className` lands on a
 * wrapper so a caller's layout classes keep working; a caller that asked for a
 * full-width button (`w-full`, as the dashboard does) still gets one.
 */
export function ReportButton({
  kind,
  range,
  extra,
  preset,
  label,
  variant = 'outline',
  full,
  className,
}: {
  kind: ReportKind;
  range: DateRange;
  extra?: Record<string, string | undefined>;
  preset?: PresetKey | 'custom';
  label?: string;
  variant?: 'outline' | 'primary' | 'ghost';
  full?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <ButtonLink
        href={reportHref(kind, range, { extra, preset })}
        variant={variant}
        size="sm"
        full={full ?? Boolean(className?.includes('w-full'))}
        title={t('report.downloadHint')}
      >
        <Download className="h-4 w-4" />
        {label ?? t('report.download')}
      </ButtonLink>
    </div>
  );
}

/** A spreadsheet file offered beside the printable sheets. */
export type CsvLink = {
  file: ExportFile;
  label: string;
  /** Every filter on screen, so the file holds what the list showed. */
  params?: Record<string, unknown>;
};

/** Below `sm` the menu is a bottom sheet: a dropdown hangs off the thumb's reach and clips. */
function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}

/**
 * Every report, behind one button, with the current range already applied.
 *
 * A menu rather than a row of buttons: there are thirteen, the labels are long in
 * Bengali, and a phone toolbar that wraps to three lines pushes the list itself
 * below the fold. On a phone it opens as a bottom sheet with full-width rows.
 */
export function DownloadMenu({
  range,
  preset,
  only,
  extra,
  csv,
  className,
}: {
  range: DateRange;
  preset?: PresetKey | 'custom';
  /** Narrow the list, for a page where the others make no sense. */
  only?: ReportKind[];
  extra?: Record<string, string | undefined>;
  /** Spreadsheet downloads, listed under the sheets. */
  csv?: CsvLink[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const phone = usePhone();

  useEffect(() => {
    if (!open || phone) return;
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
  }, [open, phone]);

  const items = only ? REPORTS.filter((report) => only.includes(report.kind)) : REPORTS;

  const list = (
    <>
      {items.map((report) => (
        <Link
          key={report.kind}
          role="menuitem"
          href={reportHref(report.kind, range, { extra, preset })}
          onClick={() => setOpen(false)}
          className="flex min-h-11 items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted"
        >
          <report.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{t(report.labelKey)}</span>
            <span className="block text-xs text-muted-foreground">{t(report.hintKey)}</span>
          </span>
        </Link>
      ))}

      {csv && csv.length > 0 && (
        <>
          <p className="border-t border-border px-3 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
            {t('report.export')}
          </p>
          {csv.map((link) => (
            <a
              key={link.file}
              role="menuitem"
              href={exportHref(link.file, link.params)}
              download
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted"
            >
              <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-success-ink" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{tf('report.csvOf', { name: link.label })}</span>
                <span className="block text-xs text-muted-foreground">{t('report.exportHint')}</span>
              </span>
            </a>
          ))}
        </>
      )}
    </>
  );

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

      {open && phone && (
        <Modal open onClose={() => setOpen(false)} title={t('report.pickChoose')}>
          <div role="menu" className="-mx-5 sm:-mx-6">
            {list}
          </div>
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            {t('report.downloadHint')}
          </p>
        </Modal>
      )}

      {open && !phone && (
        <div
          role="menu"
          className="menu-in absolute right-0 z-40 mt-1 flex max-h-[min(32rem,calc(100dvh-8rem))] w-[17rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface elev-2"
        >
          <p className="shrink-0 border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
            {t('report.pickChoose')}
          </p>

          <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>

          {/*
           * Said once, here, rather than on each button. The browser's print
           * sheet is where a PDF is actually saved, and someone meeting it for
           * the first time will not guess that.
           */}
          <p className="shrink-0 border-t border-border bg-muted/50 px-3 py-2 text-[0.6875rem] text-muted-foreground">
            {t('report.downloadHint')}
          </p>
        </div>
      )}
    </div>
  );
}
