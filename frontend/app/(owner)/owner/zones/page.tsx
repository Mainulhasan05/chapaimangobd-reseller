'use client';

import { useMemo, useRef, useState } from 'react';
import { ChevronDown, MapPin, MapPinOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatNumber } from '@/lib/format';
import { checkMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { DISTRICTS, districtLabel } from '@/lib/districts';
import type { DeliveryZone } from '@/lib/types';
import {
  useCreateZoneMutation,
  useDeleteZoneMutation,
  useGetZonesQuery,
  useUpdateZoneMutation,
} from '@/lib/store/endpoints/catalog';
import {
  Alert,
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  RowMenu,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Field, Input, MoneyInput, focusFirstInvalid } from '@/components/ui/form';
import { DistrictMultiSelect } from '@/components/ui/district-field';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';

/** How many district chips a zone shows before "আরও N". */
const CHIPS_SHOWN = 4;

const key = (district: string) => district.trim().toLowerCase();

/**
 * Districts every active zone covers, with the zone's name, leaving out one
 * zone (the one being edited). The server refuses a district in two active
 * zones; knowing which zone holds it lets the picker say so before Save.
 */
function takenMap(zones: DeliveryZone[], exceptId?: string): Map<string, string> {
  const map = new Map<string, string>();
  zones
    .filter((zone) => zone.isActive && zone.id !== exceptId)
    .forEach((zone) => zone.districts.forEach((district) => map.set(key(district), zone.name)));
  return map;
}

export default function OwnerZonesPage() {
  const toast = useToast();
  const zones = useGetZonesQuery();
  const [deleteZone] = useDeleteZoneMutation();
  const [editing, setEditing] = useState<DeliveryZone | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<DeliveryZone | null>(null);

  const all = useMemo(() => zones.data?.zones ?? [], [zones.data]);

  // The sixty-four, minus every district an active zone covers: where a
  // customer cannot order from at all today.
  const uncovered = useMemo(() => {
    const covered = takenMap(all);
    return DISTRICTS.filter((district) => !covered.has(key(district.value)));
  }, [all]);

  return (
    <>
      <PageHeader
        title={t('nav.zones')}
        subtitle={t('zone.help')}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('zones.new')}
          </Button>
        }
      />

      {zones.isLoading && <ListSkeleton rows={3} />}

      {zones.isError && !zones.data && (
        <ErrorState onRetry={() => zones.refetch()} isRetrying={zones.isFetching} error={zones.error} />
      )}

      {zones.data && all.length === 0 && (
        <EmptyState
          icon={MapPin}
          title={t('zones.emptyTitle')}
          description={t('zones.emptyHelp')}
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('zones.new')}
            </Button>
          }
        />
      )}

      {all.length > 0 && <Coverage uncovered={uncovered} />}

      {all.length > 0 && (
        <div className={cn('transition-opacity', zones.isFetching && 'opacity-60')}>
          <ul className="space-y-3 sm:hidden">
            {all.map((zone) => (
              <li key={zone.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold">{zone.name}</h3>
                    <p className="tabular mt-0.5 text-sm font-semibold">{formatMoney(zone.charge)}</p>
                  </div>
                  <ZoneStatus active={zone.isActive} />
                </div>
                <DistrictChips districts={zone.districts} className="mt-3" />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setEditing(zone)}>
                    <Pencil className="h-4 w-4" />
                    {t('app.edit')}
                  </Button>
                  <Button variant="quiet" className="text-danger" onClick={() => setDeleting(zone)}>
                    <Trash2 className="h-4 w-4" />
                    {t('zones.deleteConfirm')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <TableWrap>
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
              {all.map((zone) => (
                <Tr key={zone.id}>
                  <Td className="font-medium">{zone.name}</Td>
                  <Td>
                    <DistrictChips districts={zone.districts} />
                  </Td>
                  <Td className="tabular text-right">{formatMoney(zone.charge)}</Td>
                  <Td>
                    <ZoneStatus active={zone.isActive} />
                  </Td>
                  <Td className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing(zone)}>
                        {t('app.edit')}
                      </Button>
                      <RowMenu
                        label={zone.name}
                        items={[
                          {
                            label: t('zones.deleteConfirm'),
                            icon: Trash2,
                            tone: 'danger',
                            onSelect: () => setDeleting(zone),
                          },
                        ]}
                      />
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}

      {(creating || editing) && (
        <ZoneSheet
          key={editing?.id ?? 'new'}
          zone={editing}
          zones={all}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmSheet
          title={tf('zones.deleteTitle', { name: deleting.name })}
          tone="danger"
          confirmLabel={t('zones.deleteConfirm')}
          summary={
            <>
              <p className="font-semibold">{deleting.name}</p>
              <p className="text-muted-foreground">
                {tf('zones.districtCount', { count: formatNumber(deleting.districts.length) })} ·{' '}
                {formatMoney(deleting.charge)}
              </p>
            </>
          }
          consequences={[t('zones.deleteLine')]}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const zone = deleting;
            try {
              await deleteZone({ id: zone.id }).unwrap();
            } catch (error) {
              // Shown in the sheet, in words that say what to do instead.
              if (error instanceof ApiError && error.code === 'ZONE_IN_USE') throw new Error(t('zones.inUse'));
              throw error;
            }
            toast(tf('zones.deleted', { name: zone.name }));
          }}
        />
      )}
    </>
  );
}

/** On or off, in words, beside a dot: never colour alone. */
function ZoneStatus({ active }: { active: boolean }) {
  return (
    <Badge tone={active ? 'success' : 'neutral'} dot>
      {active ? t('zones.on') : t('zones.off')}
    </Badge>
  );
}

/**
 * A zone's districts by their Bengali names, the first few as chips and the rest
 * behind "আরও N". It used to print the stored English values joined by commas,
 * which on a twenty-district zone was a paragraph nobody read.
 */
function DistrictChips({ districts, className }: { districts: string[]; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? districts : districts.slice(0, CHIPS_SHOWN);
  const rest = districts.length - CHIPS_SHOWN;

  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {shown.map((district) => (
        <li key={district} className="rounded-full bg-subtle px-2.5 py-1 text-xs font-medium ring-1 ring-border">
          {districtLabel(district)}
        </li>
      ))}
      {rest > 0 && (
        <li>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
            className="tap inline-flex items-center rounded-full px-2.5 text-xs font-semibold text-primary-ink hover:bg-muted sm:min-h-0 sm:py-1"
          >
            {expanded ? t('zones.less') : tf('zones.more', { count: formatNumber(rest) })}
          </button>
        </li>
      )}
    </ul>
  );
}

/** Where nobody can order from, said once at the top rather than discovered by a customer. */
function Coverage({ uncovered }: { uncovered: typeof DISTRICTS }) {
  const [open, setOpen] = useState(false);

  if (uncovered.length === 0) {
    return (
      <Alert tone="success" icon={MapPin}>
        {t('zones.allCovered')}
      </Alert>
    );
  }

  return (
    <Alert
      tone="warning"
      icon={MapPinOff}
      title={tf('zones.uncovered', { count: formatNumber(uncovered.length) })}
    >
      <p>{t('zones.uncoveredHelp')}</p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="uncovered-districts"
        onClick={() => setOpen((prev) => !prev)}
        className="tap -ml-1 mt-1 inline-flex items-center gap-1 rounded-lg px-1 font-semibold underline underline-offset-2"
      >
        {open ? t('zones.hideDistricts') : t('zones.showDistricts')}
        <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul id="uncovered-districts" className="mt-2 flex flex-wrap gap-1.5">
          {uncovered.map((district) => (
            <li key={district.value} className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium">
              {district.bn}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

/**
 * Add or change one zone. Nothing is autofocused: on a phone the keyboard would
 * cover the district list, which is the part of this form that takes thought.
 */
function ZoneSheet({
  zone,
  zones,
  onClose,
}: {
  zone: DeliveryZone | null;
  zones: DeliveryZone[];
  onClose: () => void;
}) {
  const toast = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(zone?.name ?? '');
  /*
   * Ticked off a searchable list of the sixty-four, not typed. It used to be a
   * textarea of one name per line, and a misspelling there took a district out
   * of delivery with nothing on any screen to say why: the customer form only
   * ever offered what had been typed here, and the API matches the stored
   * string exactly. See lib/districts.ts.
   */
  const [districts, setDistricts] = useState<string[]>(zone?.districts ?? []);
  const [charge, setCharge] = useState(zone ? formatMoneyPlain(zone.charge) : '');
  const [isActive, setIsActive] = useState(zone?.isActive ?? true);
  const [tried, setTried] = useState(false);

  const [createZone, creating] = useCreateZoneMutation();
  const [updateZone, updating] = useUpdateZoneMutation();
  const saving = creating.isLoading || updating.isLoading;
  const error = zone ? updating.error : creating.error;
  const errors = fieldErrors(error);

  const taken = useMemo(() => takenMap(zones, zone?.id), [zones, zone?.id]);

  // Districts on this zone that another active zone also holds, grouped by that
  // zone, so the message names them: "ঢাকা, গাজীপুর আগেই 'ঢাকা সিটি' জোনে আছে".
  const clashes = useMemo(() => {
    if (!isActive) return [];
    const byZone = new Map<string, string[]>();
    districts.forEach((district) => {
      const owner = taken.get(key(district));
      if (owner) byZone.set(owner, [...(byZone.get(owner) ?? []), districtLabel(district)]);
    });
    return [...byZone.entries()].map(([owner, names]) =>
      tf('zones.clash', { districts: names.join(', '), zone: owner })
    );
  }, [districts, taken, isActive]);

  const chargeCheck = checkMoney(charge, { allowZero: true });
  const problems = {
    name: name.trim().length < 2 ? t('zones.nameRequired') : undefined,
    districts: districts.length === 0 ? t('zones.districtsRequired') : clashes[0],
    charge: chargeCheck.ok ? undefined : chargeCheck.error,
  };
  const hasProblem = Object.values(problems).some(Boolean);

  const initial = {
    name: zone?.name ?? '',
    districts: zone?.districts ?? [],
    charge: zone ? formatMoneyPlain(zone.charge) : '',
    isActive: zone?.isActive ?? true,
  };
  const dirty = JSON.stringify({ name, districts, charge, isActive }) !== JSON.stringify(initial);

  const save = async () => {
    setTried(true);
    if (hasProblem) {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
      return;
    }
    const body = { name: name.trim(), districts, charge: Number(charge), isActive };
    try {
      const result = zone
        ? await updateZone({ id: zone.id, ...body }).unwrap()
        : await createZone(body).unwrap();
      toast(tf(zone ? 'zones.saved' : 'zones.created', { name: result.zone.name }));
      onClose();
    } catch {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
    }
  };

  const show = (field: keyof typeof problems) =>
    errors[field] ?? (tried || (field === 'districts' && clashes.length) ? problems[field] : undefined);

  // The server's clash message names a zone but not the districts; ours does both.
  const general =
    error && !Object.keys(errors).length
      ? error instanceof ApiError && error.code === 'DISTRICT_TAKEN' && clashes.length
        ? clashes.join(' · ')
        : errorMessage(error)
      : null;

  return (
    <Modal
      open
      onClose={onClose}
      dirty={dirty}
      title={zone ? zone.name : t('zones.new')}
      footerLead={
        general ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">
            {general}
          </p>
        ) : undefined
      }
      footer={
        <>
          <ModalCancel disabled={saving} />
          <Button loading={saving} onClick={save}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef}>
        <Field label={t('zones.name')} htmlFor="zone-name" error={show('name')} required>
          <Input
            id="zone-name"
            value={name}
            placeholder={t('zones.namePlaceholder')}
            invalid={Boolean(show('name'))}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field
          label={t('order.deliveryCharge')}
          htmlFor="zone-charge"
          hint={zone ? t('zones.chargeHint') : undefined}
          error={show('charge')}
          required
        >
          <MoneyInput
            id="zone-charge"
            value={charge}
            invalid={Boolean(show('charge'))}
            onChange={(e) => setCharge(e.target.value)}
          />
        </Field>

        <div className="mb-4 rounded-xl border border-border px-3">
          {/* Previously a bare checkbox labelled only "হ্যাঁ", which answered a
              question the form never asked. */}
          <Switch
            checked={isActive}
            onChange={setIsActive}
            label={t('zone.active')}
            hint={t('zone.activeHint')}
          />
        </div>

        <Field
          label={t('order.district')}
          htmlFor="zone-districts"
          hint={t('zone.districtsHint')}
          error={show('districts')}
          required
        >
          <DistrictMultiSelect
            id="zone-districts"
            value={districts}
            onChange={setDistricts}
            taken={isActive ? taken : undefined}
            invalid={Boolean(show('districts'))}
          />
        </Field>
      </div>
    </Modal>
  );
}
