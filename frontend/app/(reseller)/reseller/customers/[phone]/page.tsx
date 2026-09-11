'use client';

import { use } from 'react';
import type { Route } from 'next';
import { CustomerDetail } from '@/components/customer-detail';

/**
 * One buyer, counted over this reseller's own orders only.
 *
 * Addressed by phone because there is no customer document behind this view.
 * The server normalises whatever arrives, so a number pasted out of a chat
 * still lands on the right buyer.
 */
export default function ResellerCustomerPage({ params }: { params: Promise<{ phone: string }> }) {
  const { phone } = use(params);

  return (
    <CustomerDetail
      base="/reseller"
      identifier={decodeURIComponent(phone)}
      backHref="/reseller/customers"
      orderHref={(order) => `/reseller/orders/${order.id}` as Route}
    />
  );
}
