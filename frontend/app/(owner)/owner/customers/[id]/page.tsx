'use client';

import { use } from 'react';
import type { Route } from 'next';
import { CustomerDetail } from '@/components/customer-detail';

/** One buyer, across every shop. Addressed by the customer record's id. */
export default function OwnerCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  // params is a Promise in Next 16; `use` unwraps it in a client component.
  const { id } = use(params);

  return (
    <CustomerDetail
      base="/owner"
      identifier={id}
      backHref="/owner/customers"
      orderHref={(order) => `/owner/orders/${order.id}` as Route}
    />
  );
}
