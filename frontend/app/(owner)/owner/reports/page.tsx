'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ClipboardList, Download, TrendingDown } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, businessDate } from '@/lib/format';
import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';

type Receivables = {
  totalOwed: number;
  openOrders: number;
  resellers: {
    id: string;
    shopName: string;
    user?: { name: string; phoneE164: string };
    owed: number;
    creditLimit: number;
    atLimit: boolean;
  }[];
};

type ProductsSold = {
  from: string;
  to: string;
  products: {
    product: string;
    name: string;
    unit: string;
    quantity: number;
    revenue: number;
    cost: number;
    orders: number;
  }[];
};

export default function OwnerReportsPage() {
  const today = businessDate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const receivables = useQuery({
    queryKey: ['owner', 'receivables'],
    queryFn: () => api.get<Receivables>('/owner/reports/receivables'),
  });

  const sold = useQuery({
    queryKey: ['owner', 'sold', from, to],
    queryFn: () => api.get<ProductsSold>(`/owner/reports/products-sold?from=${from}&to=${to}`),
  });

  const reconcile = useMutation({
    mutationFn: () =>
      api.get<{ checked: number; drifted: { reseller: string; problems: string[] }[] }>(
        '/owner/reports/reconcile'
      ),
  });

  return (
    <>
      <PageHeader
        title={t('nav.reports')}
        action={
          <div className="flex flex-wrap gap-2">
            {/* Plain links, because the export streams as a file download. */}
            <a href="/api/owner/exports/orders.csv" download>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                {t('nav.orders')} CSV
              </Button>
            </a>
            <a href="/api/owner/exports/ledger.csv" download>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                {t('wallet.ledger')} CSV
              </Button>
            </a>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          icon={TrendingDown}
          label={t('owner.receivable')}
          value={formatMoney(receivables.data?.totalOwed ?? 0)}
          tone={(receivables.data?.totalOwed ?? 0) > 0 ? 'danger' : 'neutral'}
        />
        <Stat
          icon={ClipboardList}
          tone="primary"
          label={t('nav.orders')}
          value={formatNumber(receivables.data?.openOrders ?? 0)}
        />
        <Card className="flex flex-col justify-center">
          <Button
            variant="outline"
            size="sm"
            loading={reconcile.isPending}
            onClick={() => reconcile.mutate()}
          >
            {t('owner.reconcile')}
          </Button>
          {reconcile.data && (
            <p
              className={`mt-2 text-xs ${
                reconcile.data.drifted.length === 0 ? 'text-success' : 'text-danger'
              }`}
            >
              {reconcile.data.drifted.length === 0
                ? `${formatNumber(reconcile.data.checked)} টি হিসাব মিলেছে`
                : `${formatNumber(reconcile.data.drifted.length)} টিতে গরমিল`}
            </p>
          )}
          {reconcile.error && (
            <p className="mt-2 text-xs text-danger">{errorMessage(reconcile.error)}</p>
          )}
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title={t('wallet.owed')} subtitle={t('owner.receivable')} />
        {receivables.data?.resellers.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t('app.none')} />
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr>
                  <Th>{t('auth.shopName')}</Th>
                  <Th className="text-right">{t('wallet.owed')}</Th>
                  <Th className="text-right">{t('wallet.creditLimit')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {receivables.data?.resellers.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <div className="font-medium">{row.shopName}</div>
                      <div className="tabular text-xs text-muted-foreground">
                        {row.user?.phoneE164}
                      </div>
                    </Td>
                    <Td className="tabular text-right text-danger">{formatMoney(row.owed)}</Td>
                    <Td className="tabular text-right">{formatMoney(row.creditLimit)}</Td>
                    <Td className="text-right text-xs">
                      {row.atLimit && <span className="text-danger">সীমা শেষ</span>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title={t('nav.products')} />

        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          <Field label="শুরু" htmlFor="from" className="mb-0">
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="শেষ" htmlFor="to" className="mb-0">
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        {sold.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {sold.data?.products.length === 0 && <EmptyState icon={ClipboardList} title={t('app.none')} />}

        {sold.data && sold.data.products.length > 0 && (
          <TableWrap alwaysVisible>
            <thead>
              <tr>
                <Th>{t('nav.products')}</Th>
                <Th className="text-right">{t('order.quantity')}</Th>
                <Th className="text-right">{t('nav.orders')}</Th>
                <Th className="text-right">{t('catalog.costPrice')}</Th>
                <Th className="text-right">{t('app.total')}</Th>
              </tr>
            </thead>
            <tbody>
              {sold.data.products.map((row) => (
                <Tr key={row.product}>
                  <Td className="font-medium">{row.name}</Td>
                  <Td className="tabular text-right">
                    {formatNumber(row.quantity)} {row.unit}
                  </Td>
                  <Td className="tabular text-right">{formatNumber(row.orders)}</Td>
                  <Td className="tabular text-right">{formatMoney(row.cost)}</Td>
                  <Td className="tabular text-right">{formatMoney(row.revenue)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {reconcile.data && reconcile.data.drifted.length > 0 && (
        <Alert tone="danger" title={t('owner.reconcile')}>
          {reconcile.data.drifted.map((d) => (
            <p key={d.reseller} className="mt-1 text-xs">
              {d.reseller}: {d.problems.join('; ')}
            </p>
          ))}
        </Alert>
      )}
    </>
  );
}
