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
 * Everything on screen that cannot be printed carries `print-hide`, and every
 * block that must not be torn across two sheets carries `print-block`.
 */

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatDateTime } from '@/lib/format';
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
 * The screen-only strip above a report: get out, and print.
 *
 * `print-hide` rather than a media query on each button, so that the strip is
 * one thing to think about. The print button is the whole point of the page, so
 * it is a primary button and it says what the next dialog will offer, because
 * "Save as PDF" lives inside the browser's own print sheet and a person who has
 * not met it before will not go looking.
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
    <div className="print-hide mb-5 flex flex-wrap items-center gap-2">
      <Link href={back}>
        <Button variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" />
          {backLabel ?? t('app.back')}
        </Button>
      </Link>
      <div className="hidden flex-1 sm:block" />
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

/**
 * The document itself: letterhead, what this is, which days it covers, and when
 * it was produced.
 *
 * The range and the timestamp are not decoration. A sheet that does not say
 * which days it covers is not evidence of anything, and one that does not say
 * when it was printed cannot be told apart from yesterday's copy of itself.
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
  const business = brand.data?.settings.businessName;
  const phone = brand.data?.settings.supportPhone;

  return (
    <article className="report">
      <header className="print-block mb-6 flex items-start justify-between gap-4 border-b-2 border-foreground pb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
          {range && <p className="mt-1 text-sm font-semibold">{range}</p>}
          {meta && <p className="mt-1 text-xs text-muted-foreground">{meta}</p>}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-base font-bold">{business ?? ' '}</p>
          {phone && <p className="tabular text-xs text-muted-foreground">{phone}</p>}
          <p className="mt-1 text-[0.6875rem] text-muted-foreground">
            {t('report.generatedAt')} {formatDateTime(new Date())}
          </p>
        </div>
      </header>

      {children}
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
    <section className={cn('mb-6', breakBefore && 'print-break', className)}>
      {title && (
        <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-border pb-1">
          <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * The figures that lead a report.
 *
 * Boxes rather than cards: a printed report wants ruled cells, and the card
 * treatment on screen is a shadow, which prints as a grey smudge. Two across on
 * a phone, four on paper and on a wide screen.
 */
export function KeyFigures({ children }: { children: React.ReactNode }) {
  return (
    <div className="print-block mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 print:grid-cols-4 print:rounded-none">
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
    <div className="bg-surface px-3 py-2.5">
      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'tabular mt-0.5 text-lg font-bold leading-tight',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success'
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * A report table.
 *
 * Unlike the panel's own tables this one never hides columns and never becomes
 * cards: a report is a document, and a document that rearranged itself by
 * viewport would print differently depending on which phone opened it. It
 * scrolls sideways on screen if it must, and prints at full width.
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
  return (
    <div className="scroll-x print:overflow-visible">
      <table className={cn('w-full min-w-[34rem] text-sm print:min-w-0', className)}>
        <thead>
          <tr className="border-b border-foreground">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
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
        'whitespace-nowrap px-2 py-1.5 text-left text-xs font-bold uppercase tracking-wide',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className
      )}
    >
      {children}
    </th>
  );
}

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
        'border-b border-border px-2 py-1.5 align-top',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className
      )}
    >
      {children}
    </td>
  );
}

/** The totals line under a report table. Bold, ruled, and never split. */
export function RTotalRow({ children }: { children: React.ReactNode }) {
  return (
    <tr className="print-block border-t-2 border-foreground font-bold">{children}</tr>
  );
}

/** Where the sheet stops. Says so, because a report has to end deliberately. */
export function ReportFooter({ note }: { note?: string }) {
  const brand = useBrand();

  return (
    <footer className="print-block mt-8 border-t border-border pt-2 text-[0.6875rem] text-muted-foreground">
      {note && <p className="mb-0.5">{note}</p>}
      <p>{brand.data?.settings.businessName}</p>
    </footer>
  );
}
