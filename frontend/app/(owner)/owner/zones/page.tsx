'use client';

import { useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain } from '@/lib/format';
import type { DeliveryZone } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input, MoneyInput, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';

export default function OwnerZonesPage() {
  const [editing, setEditing] = useState<DeliveryZone | null>(null);
  const [creating, setCreating] = useState(false);

  const zones = useQuery({
    queryKey: ['owner', 'zones'],
    queryFn: () => api.get<{ zones: DeliveryZone[] }>('/owner/delivery-zones'),
  });

  return (
    <>
      <PageHeader
        title={t('nav.zones')}
        subtitle="ক্রেতা জেলা বাছাই করলে এই চার্জ যোগ হবে"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('nav.zones')}
          </Button>
        }
      />

      {zones.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {zones.data?.zones.length === 0 && (
        <EmptyState icon={MapPin} title={t('app.none')} />
      )}

      {zones.data && zones.data.zones.length > 0 && (
        <TableWrap alwaysVisible>
          <thead>
            <tr>
              <Th>{t('nav.zones')}</Th>
              <Th>{t('order.district')}</Th>
              <Th className="text-right">{t('order.deliveryCharge')}</Th>
              <Th>{t('app.status')}</Th>
              <Th className="text-right">{t('app.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {zones.data.zones.map((zone) => (
              <Tr key={zone.id}>
                <Td className="font-medium">{zone.name}</Td>
                <Td className="text-sm text-muted-foreground">{zone.districts.join(', ')}</Td>
                <Td className="tabular text-right">{formatMoney(zone.charge)}</Td>
                <Td>
                  <Badge tone={zone.isActive ? 'success' : 'neutral'}>
                    {zone.isActive ? t('app.yes') : t('app.no')}
                  </Badge>
                </Td>
                <Td className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setEditing(zone)}>
                    {t('app.edit')}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {(creating || editing) && (
        <ZoneModal
          zone={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ZoneModal({ zone, onClose }: { zone: DeliveryZone | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(zone?.name ?? '');
  // One district per line is easier to paste in than a comma-separated string.
  const [districts, setDistricts] = useState((zone?.districts ?? []).join('\n'));
  const [charge, setCharge] = useState(zone ? formatMoneyPlain(zone.charge) : '');
  const [isActive, setIsActive] = useState(zone?.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        districts: districts
          .split('\n')
          .map((d) => d.trim())
          .filter(Boolean),
        charge: Number(charge),
        isActive,
      };
      return zone
        ? api.patch(`/owner/delivery-zones/${zone.id}`, body)
        : api.post('/owner/delivery-zones', body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'zones'] });
      onClose();
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <Modal
      open
      onClose={onClose}
      title={zone ? zone.name : t('nav.zones')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}

      <Field label={t('nav.zones')} htmlFor="name" error={errors.name} required>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>

      <Field
        label={t('order.district')}
        htmlFor="districts"
        hint="প্রতি লাইনে একটি জেলা"
        error={errors.districts}
        required
      >
        <Textarea
          id="districts"
          rows={5}
          value={districts}
          onChange={(e) => setDistricts(e.target.value)}
        />
      </Field>

      <Field label={t('order.deliveryCharge')} htmlFor="charge" error={errors.charge} required>
        <MoneyInput id="charge" value={charge} onChange={(e) => setCharge(e.target.value)} />
      </Field>

      {/* Previously a bare checkbox labelled only "হ্যাঁ", which answered a
          question the form never asked. */}
      <Switch
        checked={isActive}
        onChange={setIsActive}
        label={t('zone.active')}
        hint={t('zone.activeHint')}
      />
    </Modal>
  );
}
