'use client';

/**
 * The printable report, as a set of pieces every report is built from.
 *
 * A report here is an ordinary page that happens to print well, not a file the
 * server renders. The whole app is in Bengali, and Bengali needs real text
 * shaping — reordered vowels, conjuncts — which the browser already does
 * correctly on every other screen. Rendering the same words server-side would
 * mean re-doing that work against an embedded font and hoping each product name
 * survived it. The print rules live in `globals.css` under `@media print`.
 *
 * On screen the report is a sheet of paper laid on the page ground, shaped like
 * an invoice: a letterhead, a details strip, the figures, ruled tables, and a
 * footer that closes it. It is the same document on paper, so what someone sees
 * on their phone is what the courier is handed.
 *
 * Nothing in here may be wider than the screen. Every table scrolls inside its
 * own box, every grid cell may shrink (`min-w-0`), and a long figure breaks
 * rather than pushing the sheet past the edge of a 360px phone.
 *
 * Everything on screen that cannot be printed carries `print-hide`, and every
 * block that must not be torn across two sheets carries `print-block`.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type Brand = {
  businessName: string;
  supportPhone?: string | null;
  brandLogoUrl?: string | null;
};

/**
 * The letterhead. Read from settings rather than hard-coded, because a report
 * leaves the building: it is handed to a courier, shown to a reseller, kept as
 * a record of what was agreed.
 */
export function useBrand() {
  return useQuery({
    queryKey: ['owner', 'settings', 'brand'],
    queryFn: () => api.get<{ settings: Brand }>('/owner/settings'),
    staleTime: 10 * 60_000,
  });
}

/**
 * The moment the sheet was produced, fixed on first render.
 *
 * Read once rather than on every render, so the time printed in the details
 * strip and the time in the footer are the same minute, and a refetch does not
 * quietly move it.
 */
function useGeneratedAt() {
  const [at] = useState(() => new Date());
  return at;
}

/**
 * The screen-only strip above a report: get out, and print.
 *
 * `print-hide` rather than a media query on each button, so that the strip is
 * one thing to think about. The print button is the whole point of the page, so
 * it is a primary button, and the hint beside it says where the PDF is saved,
 * because "Save as PDF" lives inside the browser's own print sheet and a person
 * who has not met it before will not go looking.
 */
export function PrintBar({
  back,
  backLabel,
  children,
}: {
  back: Route;
  backLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="print-hide mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-2">
      <Link href={back}>
        <Button variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" />
          {backLabel ?? t('app.back')}
        </Button>
      </Link>
      <div className="flex-1" />
      <p className="hidden text-xs text-muted-foreground md:block">{t('report.downloadHint')}</p>
      {children}
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="h-4 w-4" />
        {t('report.print')}
      </Button>
    </div>
  );
}

/**
 * Opens the browser's print dialog once, as soon as the report has its data.
 *
 * Only when the caller asks for it, which is how the download buttons elsewhere
 * in the panel behave: pressing "download today's orders" should land on the
 * print sheet, not on a page with another button to find. A report opened by
 * hand is left alone. Guarded by a ref because React may render twice and two
 * print dialogs cannot be dismissed in one gesture.
 */
export function useAutoPrint(ready: boolean, enabled: boolean) {
  const fired = useRef(false);

  useEffect(() => {
    if (!enabled || !ready || fired.current) return;
    fired.current = true;
    /*
     * One frame, so the browser has laid the sheet out before it is captured.
     * Printing inside the same tick prints a half-built page.
     */
    const id = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(id);
  }, [ready, enabled]);
}

/** The business mark: the uploaded logo, or its initial on a mango tile. */
function BrandMark({ name, logo }: { name?: string; logo?: string | null }) {
  if (logo) {
    return (
      // A hosted image of unknown size; next/image would need its dimensions.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        className="h-12 w-12 shrink-0 rounded-xl border border-border object-contain p-1"
      />
    );
  }

  return (
    <span
      aria-hidden
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand text-xl font-bold text-brand-foreground"
    >
      {name?.trim().charAt(0) ?? ''}
    </span>
  );
}

/** One label and value in the details strip under the letterhead. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

/**
 * The document itself: letterhead, what this is, which days it covers, and when
 * it was produced.
 *
 * The range and the timestamp are not decoration. A sheet that does not say
 * which days it covers is not evidence of anything, and one that does not say
 * when it was printed cannot be told apart from yesterday's copy of itself. A
 * report with no range is a snapshot — a balance, a stock count — so it says
 * which day it is the state of instead.
 */
export function ReportSheet({
  title,
  subtitle,
  range,
  meta,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Already-formatted, e.g. "১৬ সেপ্টেম্বর" or "১ – ৭ সেপ্টেম্বর". */
  range?: string;
  /** A short line of context, such as how many rows the sheet carries. */
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  const brand = useBrand();
  const settings = brand.data?.settings;
  const generatedAt = useGeneratedAt();

  return (
    <article className="report-paper -mx-4 border-y border-border bg-surface elev-1 sm:mx-auto sm:max-w-[210mm] sm:rounded-2xl sm:border-x">
      {/* The brand's edge. Thin enough to print without wasting ink. */}
      <div aria-hidden className="h-1.5 bg-brand sm:rounded-t-2xl print:h-1 print:rounded-none" />

      <div className="px-4 py-6 sm:px-10 sm:py-9 print:px-0 print:py-4">
        <header className="print-block mb-6 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between print:flex-row print:items-start print:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark name={settings?.businessName} logo={settings?.brandLogoUrl} />
            <div className="min-w-0">
              <p className="text-lg font-bold leading-tight [overflow-wrap:anywhere]">
                {settings?.businessName ?? ' '}
              </p>
              {settings?.supportPhone && (
                <p className="tabular text-xs text-muted-foreground">{settings.supportPhone}</p>
              )}
            </div>
          </div>

          <div className="min-w-0 sm:max-w-[60%] sm:text-right print:max-w-[60%] print:text-right">
            {/*
             * No letter-spacing: any tracking switches off ligatures, and
             * Bengali conjuncts are ligatures.
             */}
            <p className="text-xs font-semibold text-brand-ink">{t('report.reports')}</p>
            <h1 className="text-xl font-bold leading-tight sm:text-2xl">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </header>

        <dl className="print-block mb-7 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-subtle px-4 py-3.5 sm:grid-cols-3 print:grid-cols-3">
          <Detail label={range ? t('report.period') : t('report.asOf')}>
            {range ?? formatDate(generatedAt)}
          </Detail>
          <Detail label={t('report.generated')}>
            <span className="tabular">{formatDateTime(generatedAt)}</span>
          </Detail>
          {meta && (
            <div className="col-span-2 sm:col-span-1 print:col-span-1">
              <Detail label={t('report.contents')}>{meta}</Detail>
            </div>
          )}
        </dl>

        {children}
      </div>
    </article>
  );
}

/** A titled block inside a report. Kept whole on one sheet where it can be. */
export function ReportSection({
  title,
  hint,
  children,
  className,
  breakBefore,
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  /** Start this section on a fresh sheet of paper. */
  breakBefore?: boolean;
}) {
  return (
    <section className={cn('mb-8 min-w-0', breakBefore && 'print-break', className)}>
      {title && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <h2 className="flex items-center gap-2 text-[0.9375rem] font-bold">
            <span aria-hidden className="h-4 w-1 shrink-0 rounded-full bg-brand" />
            {title}
          </h2>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * The figures that lead a report, as the boxed totals an invoice opens with.
 *
 * Two across on a phone, four on paper and on a wide screen. Every cell may
 * shrink and every value may break, because a seven-digit taka amount in a
 * 160px cell is exactly what used to push the sheet off the side of the screen.
 */
export function KeyFigures({ children }: { children: React.ReactNode }) {
  return (
    <div className="print-block mb-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 print:grid-cols-4">
      {children}
    </div>
  );
}

export function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'danger' | 'success';
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border border-border px-3 py-3 sm:px-4',
        tone === 'danger' && 'border-danger/30 bg-danger-soft',
        tone === 'success' && 'border-success/30 bg-success-soft'
      )}
    >
      <p className="text-[0.6875rem] font-medium leading-snug text-muted-foreground">{label}</p>
      <p
        className={cn(
          'tabular mt-1 text-base font-bold leading-tight [overflow-wrap:anywhere] sm:text-lg',
          tone === 'danger' && 'text-danger-ink',
          tone === 'success' && 'text-success-ink'
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-[0.6875rem] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * A report table, ruled like the line items on an invoice.
 *
 * Unlike the panel's own tables this one never hides columns and never becomes
 * cards: a report is a document, and a document that rearranged itself by
 * viewport would print differently depending on which phone opened it. Text
 * columns wrap and figure columns do not, so most tables fit a phone outright;
 * one that still cannot scrolls sideways inside its own box, and never the page.
 */
export function ReportTable({
  head,
  children,
  className,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  /*
   * Whether columns are hidden past the right edge. A table cut off cleanly at
   * a column boundary looks finished, so the edge fades while there is more,
   * and stops fading once the last column is in view.
   */
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const measure = () => setMore(box.scrollLeft + box.clientWidth < box.scrollWidth - 2);
    measure();
    box.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      box.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <div ref={scroller} className="report-table scroll-x rounded-xl border border-border">
        <table
          className={cn(
            'w-full border-collapse text-[0.8125rem] leading-snug sm:text-sm',
            className
          )}
        >
          <thead className="bg-subtle">
            <tr>{head}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {more && (
        <div
          aria-hidden
          className="print-hide pointer-events-none absolute inset-y-px right-px w-10 rounded-r-xl bg-gradient-to-l from-surface to-transparent"
        />
      )}
    </div>
  );
}

export function RTh({
  children,
  align,
  className,
}: {
  children?: React.ReactNode;
  align?: 'right' | 'center';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border px-3 py-2.5 text-left align-bottom text-xs font-semibold text-muted-foreground',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className
      )}
    >
      {children}
    </th>
  );
}

/**
 * A cell. A right-aligned cell is a figure, and a figure never wraps: a taka
 * amount split over two lines reads as two amounts.
 */
export function RTd({
  children,
  align,
  className,
}: {
  children?: React.ReactNode;
  align?: 'right' | 'center';
  className?: string;
}) {
  return (
    <td
      className={cn(
        'border-t border-border px-3 py-2 align-top',
        align === 'right' && 'tabular whitespace-nowrap text-right',
        align === 'center' && 'text-center',
        className
      )}
    >
      {children}
    </td>
  );
}

/** The totals line under a report table. Bold, ruled, shaded, and never split. */
export function RTotalRow({ children }: { children: React.ReactNode }) {
  return (
    <tr className="report-total print-block border-t-2 border-foreground bg-subtle font-bold">
      {children}
    </tr>
  );
}

/** What a section says when the range holds nothing for it. */
export function ReportEmpty() {
  return (
    <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
      {t('report.noRows')}
    </p>
  );
}

/**
 * Where the sheet stops. Says so, because a report has to end deliberately.
 *
 * `signatures` adds the two ruled lines a sheet that is handed over needs — who
 * prepared it and who checked it — so a dispatch sheet or a dues list can be
 * signed off on paper the way an invoice is.
 */
export function ReportFooter({ note, signatures }: { note?: string; signatures?: boolean }) {
  const brand = useBrand();
  const settings = brand.data?.settings;

  return (
    <footer className="print-block mt-10">
      {signatures && (
        <div className="mb-10 grid grid-cols-2 gap-8 pt-8 sm:gap-20">
          {[t('report.preparedBy'), t('report.checkedBy')].map((label) => (
            <div
              key={label}
              className="border-t border-foreground pt-1.5 text-center text-xs text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>
      )}

      {note && <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{note}</p>}

      <div className="flex flex-col gap-1 border-t border-border pt-3 text-[0.6875rem] text-muted-foreground sm:flex-row sm:items-center sm:justify-between print:flex-row print:justify-between">
        <p className="font-semibold text-foreground">
          {settings?.businessName}
          {settings?.supportPhone && (
            <span className="tabular font-normal text-muted-foreground">
              {' '}
              · {settings.supportPhone}
            </span>
          )}
        </p>
        <p>{t('report.computerGenerated')}</p>
      </div>
    </footer>
  );
}
