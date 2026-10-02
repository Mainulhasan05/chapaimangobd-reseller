'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  ClipboardList,
  Download,
  ExternalLink,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { ApiError, errorMessage } from '@/lib/api';
import { t, tf, tLedgerKind, tMethod, tRequestStatus, type DictKey } from '@/lib/i18n/bn';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyPlain,
  formatNumber,
  formatSignedMoney,
} from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useUrlState } from '@/lib/use-url-state';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { kycVisible } from '@/lib/kyc';
import type { KycStatus, LedgerEntry, ResellerSummary } from '@/lib/types';
import { exportHref } from '@/lib/store/endpoints/reports';
import {
  useGetDeactivationPreviewQuery,
  useGetDepositsInfiniteQuery,
  useGetResellerLedgerInfiniteQuery,
  useGetResellerQuery,
  useGetWithdrawalsInfiniteQuery,
  useLazyGetResellerReconcileQuery,
  usePostResellerLedgerEntryMutation,
  useResetResellerPasswordMutation,
  useUpdateResellerMutation,
  type ResellerDetail,
} from '@/lib/store/endpoints/people';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorState,
  PageHeader,
  PhoneLink,
  statusTone,
} from '@/components/ui/layout';
import { BackLink } from '@/components/ui/back-link';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, MoneyInput, Textarea } from '@/components/ui/form';
import { Segmented } from '@/components/ui/toolbar';
import { Switch } from '@/components/ui/switch';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { ListSkeleton, Skeleton, StatSkeleton } from '@/components/ui/skeleton';
import { LoadMore } from '@/components/ui/load-more';
import { useToast } from '@/components/ui/toast';

/**
 * One reseller: who they are, what they owe, and every lever the owner has.
 *
 * This used to be a single "manage" sheet opened from the list, holding a
 * deactivation switch, a credit limit, a manual ledger entry form and the
 * ledger itself in one scroll, with nothing linking out to their orders, their
 * shop or their requests. It is a page now, linkable from the dashboard's
 * debtors and from every finance row, in three sections so the switch that
 * closes a shop is never one scroll away from the field that moves money.
 */

type Section = 'account' | 'money' | 'ledger';
const SECTIONS: Section[] = ['account', 'money', 'ledger'];

const KYC_LABEL: Record<KycStatus, DictKey> = {
  not_submitted: 'kyc.notSubmitted',
  pending: 'kyc.pending',
  approved: 'kyc.approved',
  rejected: 'kyc.rejected',
};

type Reseller = ResellerDetail['reseller'];

export default function OwnerResellerPage({ params }: { params: Promise<{ id: string }> }) {
  // params is a Promise in Next 16; `use` unwraps it in a client component.
  const { id } = use(params);
  const detail = useGetResellerQuery({ id });
  const [filters, setFilters] = useUrlState({ section: 'account' });
  // A temporary password on screen and not yet copied: switching section asks first.
  const [passwordUnsaved, setPasswordUnsaved] = useState(false);
  const section: Section = SECTIONS.includes(filters.section as Section)
    ? (filters.section as Section)
    : 'account';
  // A section mounts the first time it is opened and then stays, so the ledger
  // is not fetched until asked for and nothing typed is lost on a switch.
  const [opened, setOpened] = useState<Section[]>([section]);
  if (!opened.includes(section)) setOpened([...opened, section]);

  if (detail.isLoading) {
    return (
      <>
        <BackLink fallback="/owner/resellers" />
        <Skeleton className="mb-2 h-8 w-48" />
        <Skeleton className="mb-6 h-4 w-32" />
        <StatSkeleton count={4} />
        <ListSkeleton rows={3} />
      </>
    );
  }

  if (detail.isError || !detail.data) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <>
        <BackLink fallback="/owner/resellers" />
        <PageHeader title={t('nav.resellers')} />
        {missing ? (
          <EmptyState icon={ShieldAlert} title={t('resellerDetail.notFound')} />
        ) : (
          <ErrorState onRetry={() => detail.refetch()} isRetrying={detail.isFetching} error={detail.error} />
        )}
      </>
    );
  }

  const { reseller, stats, kyc } = detail.data;
  const isActive = reseller.user?.isActive ?? true;

  return (
    <>
      <BackLink fallback="/owner/resellers" />
      <PageHeader
        title={reseller.shopName}
        subtitle={reseller.user?.name}
        action={
          <ButtonLink
            href={`/r/${reseller.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="sm"
          >
            <ExternalLink aria-hidden className="h-4 w-4" />
            {t('resellerDetail.openShop')}
          </ButtonLink>
        }
      />

      <div className="-mt-4 mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <PhoneLink phone={reseller.user?.phoneE164} />
        <Badge tone={isActive ? 'success' : 'danger'} dot>
          {isActive ? t('reseller.active') : t('reseller.inactive')}
        </Badge>
        {kycVisible(reseller) && (
          <Badge tone={statusTone(reseller.kycStatus)} dot>
            {t('kyc.title')}: {t(KYC_LABEL[reseller.kycStatus])}
          </Badge>
        )}
        {reseller.address && <span className="text-muted-foreground">{reseller.address}</span>}
      </div>

      <MoneySummary reseller={reseller} />

      {stats && (
        <Card className="mb-5 p-4 sm:p-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label={t('resellerDetail.orders')} value={formatNumber(stats.orderCount)} />
            <Figure label={t('resellerDetail.delivered')} value={formatNumber(stats.deliveredCount)} />
            <Figure
              label={t('resellerDetail.ownerRevenue')}
              value={formatMoney(stats.salesTotal)}
              hint={t('resellerDetail.ownerRevenueHint')}
            />
            <Figure
              label={t('resellerDetail.lastOrder')}
              value={stats.lastOrderAt ? formatDate(stats.lastOrderAt) : '—'}
            />
          </dl>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
            <ButtonLink href={`/owner/orders?reseller=${reseller.id}`} variant="outline" size="sm">
              <ClipboardList aria-hidden className="h-4 w-4" />
              {t('resellerDetail.viewOrders')}
            </ButtonLink>
            {kyc && (
              <ButtonLink href={`/owner/kyc?status=${kyc.status}`} variant="outline" size="sm">
                <ShieldCheck aria-hidden className="h-4 w-4" />
                {t('resellerDetail.viewKyc')}
              </ButtonLink>
            )}
          </div>
        </Card>
      )}

      <PendingRequests resellerId={reseller.id} />

      <Segmented
        className="mb-4"
        label={t('resellerDetail.sections')}
        value={section}
        onChange={(value) => {
          if (passwordUnsaved && !window.confirm(t('resellerDetail.tempNotCopiedSwitch'))) return;
          setFilters({ section: value });
        }}
        options={[
          { value: 'account', label: t('resellerDetail.tabAccount') },
          { value: 'money', label: t('resellerDetail.tabMoney') },
          { value: 'ledger', label: t('resellerDetail.tabLedger') },
        ]}
      />

      {/*
       * Opened sections stay mounted and only the chosen one shows. Unmounting them
       * threw away a one-time temporary password, the list of orders a
       * deactivation cancelled and a half-typed ledger entry on every switch.
       */}
      {opened.includes('account') && (
        <div hidden={section !== 'account'}>
          <AccountSection detail={detail.data} onPasswordUnsaved={setPasswordUnsaved} />
        </div>
      )}
      {opened.includes('money') && (
        <div hidden={section !== 'money'}>
          <MoneySection reseller={reseller} />
        </div>
      )}
      {opened.includes('ledger') && (
        <div hidden={section !== 'ledger'}>
          <LedgerSection resellerId={reseller.id} />
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- figures -- */

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/60 px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'tabular truncate text-lg font-bold',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger'
        )}
      >
        {value}
      </dd>
      {hint && <p className="text-[0.6875rem] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The three numbers every conversation with a reseller starts from. */
function MoneySummary({ reseller }: { reseller: ResellerSummary }) {
  return (
    <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="col-span-2 rounded-xl border border-border bg-surface p-4 sm:col-span-1">
        <dt className="text-xs font-semibold text-muted-foreground">{t('wallet.balance')}</dt>
        <dd
          className={cn(
            'tabular mt-1 text-2xl font-bold leading-tight',
            reseller.balance < 0 ? 'text-danger' : 'text-success'
          )}
        >
          {formatSignedMoney(reseller.balance)}
        </dd>
        <p className="mt-1 text-xs text-muted-foreground">
          {reseller.balance < 0 ? t('resellerDetail.owesYou') : t('resellerDetail.youHold')}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <dt className="text-xs font-semibold text-muted-foreground">{t('wallet.creditLimit')}</dt>
        <dd className="tabular mt-1 text-xl font-bold leading-tight">{formatMoney(reseller.creditLimit)}</dd>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <dt className="text-xs font-semibold text-muted-foreground">{t('wallet.available')}</dt>
        <dd className="tabular mt-1 text-xl font-bold leading-tight">{formatMoney(reseller.available)}</dd>
      </div>
    </dl>
  );
}

/** Requests waiting on the owner for this reseller, linked to the right queue. */
function PendingRequests({ resellerId }: { resellerId: string }) {
  const deposits = useGetDepositsInfiniteQuery({ status: 'pending', resellerId, limit: 1 });
  const withdrawals = useGetWithdrawalsInfiniteQuery({ status: 'pending', resellerId, limit: 1 });
  const depositCount = deposits.data?.pages[0]?.total ?? 0;
  const withdrawalCount = withdrawals.data?.pages[0]?.total ?? 0;
  if (!depositCount && !withdrawalCount) return null;

  return (
    <Alert tone="warning" title={t('resellerDetail.waiting')} className="mb-5">
      <div className="mt-1 flex flex-wrap gap-x-4">
        {depositCount > 0 && (
          <Link
            href={`/owner/finance?tab=deposits&status=pending&reseller=${resellerId}` as Route}
            className="tap inline-flex items-center gap-1.5 font-semibold underline underline-offset-2"
          >
            <ArrowDownToLine aria-hidden className="h-4 w-4" />
            {tf('resellerDetail.pendingDeposits', { n: formatNumber(depositCount) })}
          </Link>
        )}
        {withdrawalCount > 0 && (
          <Link
            href={`/owner/finance?tab=withdrawals&status=pending&reseller=${resellerId}` as Route}
            className="tap inline-flex items-center gap-1.5 font-semibold underline underline-offset-2"
          >
            <ArrowUpFromLine aria-hidden className="h-4 w-4" />
            {tf('resellerDetail.pendingWithdrawals', { n: formatNumber(withdrawalCount) })}
          </Link>
        )}
      </div>
    </Alert>
  );
}

/* --------------------------------------------------------------- account -- */

function AccountSection({
  detail,
  onPasswordUnsaved,
}: {
  detail: ResellerDetail;
  onPasswordUnsaved: (unsaved: boolean) => void;
}) {
  const toast = useToast();
  const { reseller, kyc } = detail;
  const [update, updating] = useUpdateResellerMutation();
  const [confirming, setConfirming] = useState<'deactivate' | 'kyc' | null>(null);
  // What the last deactivation did to pending orders, shown until the page is left.
  const [cancelledOrders, setCancelledOrders] = useState<string[] | null>(null);

  const isActive = reseller.user?.isActive ?? true;
  const deactivatedAt = reseller.user?.deactivatedAt;
  const smsEnabled = reseller.channelPrefs?.sms ?? false;
  const kycRequired = reseller.kycRequired;

  /** A switch that saves on the tap, with the outcome said either way. */
  const save = async (patch: { isActive: boolean } | { smsEnabled: boolean } | { kycRequired: boolean }) => {
    try {
      await update({ id: reseller.id, ...patch }).unwrap();
      if ('isActive' in patch) setCancelledOrders(null);
      toast(t('app.saved'));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  return (
    <Card>
      <CardHeader title={t('reseller.account')} />

      <div className="divide-y divide-border">
        <Switch
          checked={isActive}
          disabled={updating.isLoading}
          onChange={(checked) => {
            // Turning a reseller off cancels orders and closes a shop; it asks first.
            if (!checked) setConfirming('deactivate');
            else save({ isActive: true });
          }}
          label={t('reseller.active')}
          hint={
            isActive
              ? t('reseller.activeHint')
              : deactivatedAt
                ? `${t('reseller.inactiveHint')} · ${tf('reseller.deactivatedAt', { at: formatDateTime(deactivatedAt) })}`
                : t('reseller.inactiveHint')
          }
        />

        {cancelledOrders && (
          <div className="py-3">
            <Alert tone="neutral" icon={Ban} title={t('reseller.deactivatedResult')} className="mb-0">
              {cancelledOrders.length === 0 ? (
                <p>{t('reseller.deactivatedNoPending')}</p>
              ) : (
                <>
                  <p>{tf('reseller.deactivatedCancelled', { n: formatNumber(cancelledOrders.length) })}</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {cancelledOrders.map((code) => (
                      <li key={code}>
                        <Link
                          href={`/owner/orders?q=${encodeURIComponent(code)}` as Route}
                          className="tabular tap inline-flex items-center rounded-full bg-surface px-3 text-xs font-semibold underline-offset-2 ring-1 ring-border hover:underline"
                        >
                          {code}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Alert>
          </div>
        )}

        {/*
         * The switch that reveals the KYC module to one reseller. It is off for
         * everyone until the owner has a reason, so this is the only way
         * documents are ever asked for. See docs/adr/0017.
         */}
        <Switch
          checked={kycRequired}
          disabled={updating.isLoading}
          onChange={(checked) => {
            // Asking an unapproved reseller closes their shop on save: said first.
            if (checked && reseller.kycStatus !== 'approved') setConfirming('kyc');
            else save({ kycRequired: checked });
          }}
          label={t('reseller.kycRequired')}
          hint={kycRequired ? t('reseller.kycRequiredHint') : t('reseller.kycRequiredOff')}
        />

        {kycRequired && reseller.kycStatus !== 'approved' && (
          <div className="py-3">
            <Alert tone="warning" icon={ShieldAlert} className="mb-0">
              {t('reseller.kycRequiredWarn')}
              {kyc?.status === 'pending' && (
                <Link
                  href={'/owner/kyc?status=pending' as Route}
                  className="mt-1 block font-semibold underline underline-offset-2"
                >
                  {t('resellerDetail.reviewKyc')}
                </Link>
              )}
            </Alert>
          </div>
        )}

        <Switch
          checked={smsEnabled}
          disabled={updating.isLoading}
          onChange={(checked) => save({ smsEnabled: checked })}
          label={t('reseller.smsEnabled')}
          hint={`${t('reseller.smsEnabledHint')} · ${tf('resellerDetail.smsCredits', {
            n: formatNumber(reseller.smsCredits),
          })}`}
        />
      </div>

      <PasswordReset resellerId={reseller.id} onUnsavedChange={onPasswordUnsaved} />

      {confirming === 'deactivate' && (
        <DeactivateSheet
          reseller={reseller}
          onClose={() => setConfirming(null)}
          onDone={setCancelledOrders}
        />
      )}

      {confirming === 'kyc' && (
        <ConfirmSheet
          title={t('resellerDetail.kycConfirmTitle')}
          tone="danger"
          confirmLabel={t('resellerDetail.kycConfirm')}
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            await update({ id: reseller.id, kycRequired: true }).unwrap();
            toast(t('app.saved'));
          }}
          summary={<p className="font-semibold">{reseller.shopName}</p>}
          consequences={[t('reseller.kycRequiredWarn'), t('reseller.kycRequiredHint')]}
        />
      )}
    </Card>
  );
}

/**
 * Switching a reseller off, with what it will do counted before it is done:
 * how many pending orders get cancelled, that confirmed ones still go out,
 * that they keep a read-only login and may still withdraw. See docs/adr/0011.
 */
function DeactivateSheet({
  reseller,
  onClose,
  onDone,
}: {
  reseller: Reseller;
  onClose: () => void;
  onDone: (cancelled: string[]) => void;
}) {
  const toast = useToast();
  const preview = useGetDeactivationPreviewQuery({ id: reseller.id });
  const [update] = useUpdateResellerMutation();
  const pending = preview.data?.pendingOrders;

  const pendingLine =
    pending == null
      ? preview.isLoading
        ? t('resellerDetail.pendingCounting')
        : t('resellerDetail.pendingUnknown')
      : pending === 0
        ? t('reseller.deactivatedNoPending')
        : tf('resellerDetail.pendingWillCancel', { n: formatNumber(pending) });

  return (
    <ConfirmSheet
      title={t('reseller.deactivateTitle')}
      tone="danger"
      confirmLabel={t('reseller.deactivate')}
      // The count is the point of this sheet; it is not confirmed blind.
      confirmDisabled={preview.isLoading}
      onClose={onClose}
      onConfirm={async () => {
        const result = await update({ id: reseller.id, isActive: false }).unwrap();
        onDone(result.cancelledOrders ?? []);
        toast(t('reseller.deactivatedResult'));
      }}
      summary={<p className="font-semibold">{reseller.shopName}</p>}
      rows={[
        {
          label: t('resellerDetail.pendingToCancel'),
          value: pending == null ? '…' : formatNumber(pending),
          tone: pending ? 'danger' : undefined,
          strong: true,
        },
        { label: t('wallet.balance'), value: formatSignedMoney(reseller.balance) },
      ]}
      consequences={[
        pendingLine,
        t('resellerDetail.deactivateShop'),
        t('resellerDetail.deactivateConfirmed'),
        t('resellerDetail.deactivateLogin'),
        t('resellerDetail.deactivateBalance'),
      ]}
    />
  );
}

/**
 * The fallback for a reseller who cannot receive an SMS code (docs/adr/0014).
 *
 * Asks first, because it signs the reseller out everywhere. The temporary
 * password is shown once and never again: the server keeps only its hash. Until
 * it has been copied, leaving the page asks first, so a stray tap on the nav
 * cannot throw it away.
 */
function PasswordReset({
  resellerId,
  onUnsavedChange,
}: {
  resellerId: string;
  onUnsavedChange: (unsaved: boolean) => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [temporary, setTemporary] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reset] = useResetResellerPasswordMutation();

  const unsaved = Boolean(temporary) && !copied;
  useUnsavedChanges(unsaved);
  useEffect(() => onUnsavedChange(unsaved), [unsaved, onUnsavedChange]);

  return (
    <div className="mt-2 border-t border-border pt-3">
      {temporary ? (
        <Alert tone="success" title={t('reseller.temporaryPassword')} icon={KeyRound} className="mb-0">
          <div className="mt-2 flex items-center gap-2">
            <code className="tabular min-w-0 flex-1 select-all break-all rounded-lg bg-surface px-3 py-2 text-base font-semibold tracking-wider text-foreground">
              {temporary}
            </code>
            <CopyButton
              value={temporary}
              label={t('app.copy')}
              onCopied={() => {
                setCopied(true);
                toast(t('app.copied'));
              }}
            />
          </div>
          <p className="mt-2 text-xs">{t('reseller.temporaryPasswordHelp')}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => {
              if (!copied && !window.confirm(t('resellerDetail.tempNotCopied'))) return;
              setTemporary(null);
              setCopied(false);
            }}
          >
            {t('resellerDetail.tempDone')}
          </Button>
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('reseller.resetPassword')}</p>
            <p className="text-xs text-muted-foreground">{t('reseller.resetPasswordHint')}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            <KeyRound aria-hidden className="h-4 w-4" />
            {t('reseller.resetPassword')}
          </Button>
        </div>
      )}

      {confirming && (
        <ConfirmSheet
          title={t('reseller.resetPasswordTitle')}
          tone="danger"
          confirmLabel={t('reseller.resetPasswordConfirm')}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const result = await reset({ id: resellerId }).unwrap();
            setTemporary(result.temporaryPassword);
            setCopied(false);
          }}
          consequences={[t('reseller.resetPasswordHelp')]}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- money -- */

function MoneySection({ reseller }: { reseller: Reseller }) {
  return (
    <div className="space-y-4">
      <CreditLimit reseller={reseller} />
      <ManualEntry reseller={reseller} />
      <RecentRequests resellerId={reseller.id} />
    </div>
  );
}

function CreditLimit({ reseller }: { reseller: Reseller }) {
  const toast = useToast();
  const current = formatMoneyPlain(reseller.creditLimit);
  // Null until edited, so a saved value (or one changed elsewhere) shows as is.
  const [draft, setDraft] = useState<string | null>(null);
  const [update, state] = useUpdateResellerMutation();
  const value = draft ?? current;
  const changed = draft !== null && draft.trim() !== current;
  const check = checkMoney(value, { allowZero: true });

  useUnsavedChanges(changed);

  const submit = async () => {
    if (!check.ok || !changed) return;
    try {
      await update({ id: reseller.id, creditLimit: check.value }).unwrap();
      setDraft(null);
      toast(tf('resellerDetail.limitSaved', { amount: formatMoney(check.value) }));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  return (
    <Card>
      <CardHeader title={t('owner.creditLimit')} subtitle={t('resellerDetail.limitHelp')} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field
          label={t('resellerDetail.limitLabel')}
          htmlFor="creditLimit"
          error={moneyError(value, { allowZero: true })}
          hint={changed ? tf('resellerDetail.limitWas', { amount: formatMoney(reseller.creditLimit) }) : undefined}
          className="mb-3"
        >
          <MoneyInput id="creditLimit" value={value} onChange={(event) => setDraft(event.target.value)} />
        </Field>
        <Button type="submit" loading={state.isLoading} disabled={!changed} full className="sm:w-auto">
          {changed ? t('resellerDetail.limitSave') : t('resellerDetail.limitUnchanged')}
        </Button>
      </form>
    </Card>
  );
}

/**
 * A manual ledger entry: the owner putting money on, or taking it off, a
 * reseller's balance by hand. It used to be a Save button under three fields,
 * posting on the tap. Now the balance it will leave is shown while typing, the
 * button names the amount and the direction, and a confirm repeats both.
 */
function ManualEntry({ reseller }: { reseller: Reseller }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [post] = usePostResellerLedgerEntryMutation();

  const check = checkMoney(amount);
  const noteOk = note.trim().length >= 3;
  const after = check.ok ? reseller.balance + (direction === 'credit' ? check.value : -check.value) : null;
  const verb = check.ok
    ? tf(direction === 'credit' ? 'resellerDetail.addAmount' : 'resellerDetail.cutAmount', {
        amount: formatMoney(check.value),
      })
    : t('resellerDetail.entrySubmit');

  useUnsavedChanges(Boolean(amount || note.trim()));

  const amountError = tried && !check.ok ? check.error : moneyError(amount);
  const noteError = tried && !noteOk ? tf('app.minChars', { count: formatNumber(3) }) : undefined;

  return (
    <Card>
      <CardHeader title={t('owner.manualEntry')} subtitle={t('resellerDetail.entryHelp')} />

      <Segmented
        className="mb-3"
        label={t('ledger.direction')}
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'credit', label: t('resellerDetail.directionAdd') },
          { value: 'debit', label: t('resellerDetail.directionCut') },
        ]}
      />

      <Field label={t('wallet.amount')} htmlFor="entryAmount" error={amountError} required className="mb-3">
        <MoneyInput
          id="entryAmount"
          value={amount}
          invalid={Boolean(amountError)}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>

      <Field
        label={t('resellerDetail.entryNote')}
        htmlFor="entryNote"
        error={noteError}
        hint={t('resellerDetail.entryNoteHint')}
        required
        className="mb-3"
      >
        <Textarea
          id="entryNote"
          rows={2}
          value={note}
          invalid={Boolean(noteError)}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      {/* The consequence while it can still change: before and after, live. */}
      <p className="tabular mb-3 rounded-lg bg-muted px-3 py-2 text-sm">
        {t('wallet.balance')} {formatSignedMoney(reseller.balance)} →{' '}
        <span className={cn('font-bold', after != null && after < 0 ? 'text-danger' : 'text-success')}>
          {after == null ? '…' : formatSignedMoney(after)}
        </span>
      </p>

      <Button
        full
        className="sm:w-auto"
        variant={direction === 'credit' ? 'primary' : 'danger'}
        onClick={() => {
          setTried(true);
          if (check.ok && noteOk) setConfirming(true);
        }}
      >
        {verb}
      </Button>

      {confirming && check.ok && after != null && (
        <ConfirmSheet
          title={direction === 'credit' ? t('resellerDetail.addTitle') : t('resellerDetail.cutTitle')}
          tone={direction === 'credit' ? 'primary' : 'danger'}
          confirmLabel={verb}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await post({ id: reseller.id, amount: check.value, direction, note: note.trim() }).unwrap();
            toast(tf('resellerDetail.entrySaved', { shop: reseller.shopName, amount: formatSignedMoney(after - reseller.balance) }));
            setAmount('');
            setNote('');
            setTried(false);
          }}
          summary={
            <>
              <p className="font-semibold">{reseller.shopName}</p>
              <p className="mt-1 break-words text-muted-foreground">{note.trim()}</p>
            </>
          }
          rows={[
            { label: t('app.before'), value: formatSignedMoney(reseller.balance) },
            {
              label: t('app.after'),
              value: formatSignedMoney(after),
              strong: true,
              tone: after < 0 ? 'danger' : 'success',
            },
          ]}
          consequences={[t('resellerDetail.entryPermanent')]}
        />
      )}
    </Card>
  );
}

/** The last few deposits and withdrawals, with the way to all of them. */
function RecentRequests({ resellerId }: { resellerId: string }) {
  const deposits = useGetDepositsInfiniteQuery({ resellerId, limit: 5 });
  const withdrawals = useGetWithdrawalsInfiniteQuery({ resellerId, limit: 5 });

  const block = (
    kind: 'deposits' | 'withdrawals',
    query: typeof deposits | typeof withdrawals,
    rows: { id: string; amount: number; method: string; status: string; createdAt: string }[]
  ) => (
    <Card>
      <CardHeader
        title={kind === 'deposits' ? t('nav.deposits') : t('nav.withdrawals')}
        href={`/owner/finance?tab=${kind}&status=all&reseller=${resellerId}` as Route}
        hrefLabel={t('resellerDetail.seeAll')}
        className="mb-3"
      />
      {query.isLoading ? (
        <ListSkeleton rows={2} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} isRetrying={query.isFetching} error={query.error} />
      ) : rows.length === 0 ? (
        <EmptyState compact title={t('app.none')} />
      ) : (
        <ul className="-my-1 divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="tabular font-semibold">{formatMoney(row.amount)}</p>
                <p className="text-xs text-muted-foreground">
                  {tMethod(row.method)} · {formatDateTime(row.createdAt)}
                </p>
              </div>
              <Badge tone={statusTone(row.status)} dot>
                {tRequestStatus(row.status)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {block('deposits', deposits, deposits.data?.pages[0]?.deposits ?? [])}
      {block('withdrawals', withdrawals, withdrawals.data?.pages[0]?.withdrawals ?? [])}
    </div>
  );
}

/* ---------------------------------------------------------------- ledger -- */

function LedgerSection({ resellerId }: { resellerId: string }) {
  const ledger = useGetResellerLedgerInfiniteQuery({ id: resellerId });
  const [reconcile, reconciled] = useLazyGetResellerReconcileQuery();
  const entries = ledger.data?.pages.flatMap((page) => page.entries) ?? [];
  const total = ledger.data?.pages[0]?.total ?? 0;

  return (
    <Card>
      <CardHeader
        title={t('wallet.ledger')}
        action={
          <a
            href={exportHref('ledger.csv', { reseller: resellerId })}
            aria-label={t('resellerDetail.downloadLedger')}
            className="tap inline-flex items-center justify-center rounded-lg border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:min-h-9"
          >
            <Download aria-hidden className="h-4 w-4" />
            <span className="ml-1.5 hidden sm:inline">CSV</span>
          </a>
        }
      />

      <div className="mb-4">
        <Button
          size="sm"
          variant="outline"
          loading={reconciled.isFetching}
          onClick={() => reconcile({ id: resellerId })}
        >
          {t('owner.reconcile')}
        </Button>
        {reconciled.data && !reconciled.isFetching && (
          <Alert tone={reconciled.data.ok ? 'success' : 'danger'} className="mb-0 mt-3">
            {reconciled.data.ok ? (
              t('reconcile.matched')
            ) : (
              <>
                <p className="font-semibold">
                  {tf('reconcile.drifted', { n: formatNumber(reconciled.data.problems.length) })}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {reconciled.data.problems.map((problem) => (
                    <li key={problem} className="break-words">
                      {problem}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Alert>
        )}
        {reconciled.isError && !reconciled.isFetching && (
          <Alert tone="danger" className="mb-0 mt-3">
            {errorMessage(reconciled.error)}
          </Alert>
        )}
      </div>

      {ledger.isLoading && <ListSkeleton rows={4} />}

      {ledger.isError && entries.length === 0 && (
        <ErrorState onRetry={() => ledger.refetch()} isRetrying={ledger.isFetching} error={ledger.error} />
      )}

      {ledger.isSuccess && entries.length === 0 && <EmptyState compact title={t('wallet.noEntries')} />}

      {entries.length > 0 && (
        <>
          {/* Cards on a phone: four columns in 360px cut the note to nothing. */}
          <ul className="-my-1 divide-y divide-border sm:hidden">
            {entries.map((row) => (
              <li key={row.id} className="py-3">
                <LedgerCard row={row} />
              </li>
            ))}
          </ul>

          <table className="hidden w-full text-sm sm:table">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-semibold">{t('app.date')}</th>
                <th className="py-2 pr-3 font-semibold">{t('resellerDetail.entryWhat')}</th>
                <th className="py-2 pr-3 text-right font-semibold">{t('wallet.amount')}</th>
                <th className="py-2 text-right font-semibold">{t('resellerDetail.balanceAfter')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap py-2.5 pr-3 align-top text-xs text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="py-2.5 pr-3 align-top text-xs">
                    {/* The kind, in Bengali, leads; the server's note is detail. */}
                    <div className="font-medium">{tLedgerKind(row.kind)}</div>
                    {row.note && <div className="break-words text-muted-foreground">{row.note}</div>}
                  </td>
                  <td
                    className={cn(
                      'tabular py-2.5 pr-3 text-right align-top font-semibold',
                      row.amount < 0 ? 'text-danger' : 'text-success'
                    )}
                  >
                    {formatSignedMoney(row.amount)}
                  </td>
                  <td className="tabular py-2.5 text-right align-top">{formatSignedMoney(row.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <LoadMore
            compact
            hasMore={Boolean(ledger.hasNextPage)}
            loading={ledger.isFetchingNextPage}
            onLoadMore={() => ledger.fetchNextPage()}
            error={ledger.isFetchNextPageError ? ledger.error : null}
            shown={entries.length}
            total={total}
          />
        </>
      )}
    </Card>
  );
}

function LedgerCard({ row }: { row: LedgerEntry }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{tLedgerKind(row.kind)}</p>
        {row.note && <p className="break-words text-xs text-muted-foreground">{row.note}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cn('tabular font-semibold', row.amount < 0 ? 'text-danger' : 'text-success')}>
          {formatSignedMoney(row.amount)}
        </p>
        <p className="tabular text-xs text-muted-foreground">
          {t('resellerDetail.balanceAfter')} {formatSignedMoney(row.balanceAfter)}
        </p>
      </div>
    </div>
  );
}
