'use client';

import { CustomersList } from '@/components/customers-list';
import type { Route } from 'next';

/** Every buyer, across every shop. See components/customers-list.tsx. */
export default function OwnerCustomersPage() {
  return (
    <CustomersList
      base="/owner"
      detailHref={(customer) => `/owner/customers/${customer.id}` as Route}
    />
  );
}
