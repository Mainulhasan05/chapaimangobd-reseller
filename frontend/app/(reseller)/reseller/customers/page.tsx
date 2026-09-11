'use client';

import { CustomersList } from '@/components/customers-list';
import type { Route } from 'next';

/**
 * This reseller's own buyers.
 *
 * Addressed by phone rather than by an id, because there is no customer
 * document behind this view: it is an aggregation over the reseller's own
 * orders, and the number is the only stable handle.
 */
export default function ResellerCustomersPage() {
  return (
    <CustomersList
      base="/reseller"
      detailHref={(customer) =>
        `/reseller/customers/${encodeURIComponent(customer.phone)}` as Route
      }
    />
  );
}
