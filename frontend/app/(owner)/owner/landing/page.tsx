'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t, type DictKey } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { LANDING_ICONS, LANDING_LIMITS } from '@/lib/landing';
import type { LandingContent, LandingIcon } from '@/lib/types';
import { Alert, Card, CardHeader, ErrorState, PageHeader } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, FieldRow, Input, Select, Textarea } from '@/components/ui/form';
import { ImagesField } from '@/components/ui/images-field';
import { useToast } from '@/components/ui/toast';

/**
 * The owner's editor for the content every public shop page is drawn from.
 *
 * Written once for every reseller. The design each page uses is the reseller's
 * choice and the contact details are theirs; everything a customer reads about
 * the mangoes themselves comes from here. See backend domain/landing.js.
 *
 * Text is edited as a draft and saved together. Photos and reviews are sent the
 * moment they are added, for the same reason the brand logo is: a picture has
 * to reach the image host before there is anything to save.
 */

const QUERY_KEY = ['owner', 'landing'] as const;
type LandingResponse = { landing: LandingContent };

export default function OwnerLandingPage() {
  const landing = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<LandingResponse>('/owner/landing'),
  });

  if (landing.isError) {
    return (
      <>
        <PageHeader title={t('nav.landing')} />
        <ErrorState
          onRetry={() => landing.refetch()}
          isRetrying={landing.isFetching}
          error={landing.error}
        />
      </>
    );
  }

  if (!landing.data) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return <LandingEditor initial={landing.data.landing} live={landing.data.landing} />;
}

/** The text half, held as typed. The rating stays a string until it is sent. */
type Draft = Omit<LandingContent, 'heroImages' | 'reviews' | 'rating'> & { rating: string };

function LandingEditor({ initial, live }: { initial: LandingContent; live: LandingContent }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [draft, setDraft] = useState<Draft>(() => ({
    headline: initial.headline,
    subtitle: initial.subtitle,
    videoUrl: initial.videoUrl,
    rating: initial.rating == null ? '' : String(initial.rating),
    customerCount: initial.customerCount,
    deliveryNote: initial.deliveryNote,
    guaranteeNote: initial.guaranteeNote,
    badges: initial.badges,
    whyUs: initial.whyUs,
    features: initial.features,
    tips: initial.tips,
    faqs: initial.faqs,
  }));

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  /** Every write answers with the whole content, which becomes the cached copy. */
  const store = (data: LandingResponse) => queryClient.setQueryData(QUERY_KEY, data);

  const save = useMutation({
    mutationFn: () =>
      api.patch<LandingResponse>('/owner/landing', {
        headline: draft.headline,
        subtitle: draft.subtitle,
        videoUrl: draft.videoUrl.trim(),
        rating: draft.rating.trim() === '' ? null : Number(draft.rating),
        customerCount: draft.customerCount,
        deliveryNote: draft.deliveryNote,
        guaranteeNote: draft.guaranteeNote,
        // Half-filled rows are dropped rather than refused: an empty row is an
        // "add" that was never used, not a mistake worth blocking the save for.
        badges: draft.badges.filter((b) => b.label.trim()),
        whyUs: draft.whyUs.filter((item) => item.trim()),
        features: draft.features.filter((item) => item.trim()),
        tips: draft.tips.filter((tip) => tip.title.trim() && tip.text.trim()),
        faqs: draft.faqs.filter((faq) => faq.q.trim() && faq.a.trim()),
      }),
    onSuccess: (data) => {
      store(data);
      toast(t('landingEdit.saved'));
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <>
      <PageHeader title={t('nav.landing')} subtitle={t('landingEdit.subtitle')} />

      <HeroImages images={live.heroImages} onStored={store} />

      <Card className="mb-4">
        <CardHeader title={t('landingEdit.hero')} />

        <Field label={t('landingEdit.headline')} htmlFor="headline" error={errors.headline}>
          <Input id="headline" maxLength={120} value={draft.headline} onChange={(e) => set('headline', e.target.value)} />
        </Field>
        <Field label={t('landingEdit.subtitleField')} htmlFor="subtitle" error={errors.subtitle}>
          <Textarea
            id="subtitle"
            rows={2}
            maxLength={300}
            value={draft.subtitle}
            onChange={(e) => set('subtitle', e.target.value)}
          />
        </Field>
        <Field
          label={t('landingEdit.videoUrl')}
          htmlFor="videoUrl"
          hint={t('landingEdit.videoUrlHint')}
          error={errors.videoUrl}
        >
          <Input
            id="videoUrl"
            type="url"
            inputMode="url"
            placeholder="https://youtu.be/..."
            value={draft.videoUrl}
            onChange={(e) => set('videoUrl', e.target.value)}
          />
        </Field>
        <FieldRow className="mb-1 sm:grid-cols-2">
          <Field label={t('landingEdit.rating')} htmlFor="rating" error={errors.rating}>
            <Input
              id="rating"
              type="number"
              inputMode="decimal"
              min={0}
              max={5}
              step={0.1}
              value={draft.rating}
              onChange={(e) => set('rating', e.target.value)}
            />
          </Field>
          <Field label={t('landingEdit.customerCount')} htmlFor="customerCount" error={errors.customerCount}>
            <Input
              id="customerCount"
              maxLength={30}
              placeholder="৫,০০০+"
              value={draft.customerCount}
              onChange={(e) => set('customerCount', e.target.value)}
            />
          </Field>
        </FieldRow>
        <p className="mb-4 text-xs text-muted-foreground">{t('landingEdit.trustHint')}</p>

        <Field label={t('landingEdit.deliveryNote')} htmlFor="deliveryNote" error={errors.deliveryNote}>
          <Input
            id="deliveryNote"
            maxLength={120}
            value={draft.deliveryNote}
            onChange={(e) => set('deliveryNote', e.target.value)}
          />
        </Field>
        <Field
          label={t('landingEdit.guaranteeNote')}
          htmlFor="guaranteeNote"
          error={errors.guaranteeNote}
          className="mb-0"
        >
          <Input
            id="guaranteeNote"
            maxLength={160}
            value={draft.guaranteeNote}
            onChange={(e) => set('guaranteeNote', e.target.value)}
          />
        </Field>
      </Card>

      <Card className="mb-4">
        <CardHeader title={t('landingEdit.badges')} subtitle={limitNote(LANDING_LIMITS.badges)} />
        <RowList
          items={draft.badges}
          max={LANDING_LIMITS.badges}
          onChange={(badges) => set('badges', badges)}
          blank={{ icon: 'check' as LandingIcon, label: '' }}
          render={(badge, update) => (
            <div className="flex gap-2">
              <IconSelect value={badge.icon} onChange={(icon) => update({ ...badge, icon })} />
              <Input
                aria-label={t('landingEdit.title')}
                maxLength={40}
                value={badge.label}
                onChange={(e) => update({ ...badge, label: e.target.value })}
              />
            </div>
          )}
        />
      </Card>

      <Card className="mb-4">
        <CardHeader title={t('landingEdit.whyUs')} subtitle={limitNote(LANDING_LIMITS.whyUs)} />
        <TextList items={draft.whyUs} max={LANDING_LIMITS.whyUs} onChange={(whyUs) => set('whyUs', whyUs)} />
      </Card>

      <Card className="mb-4">
        <CardHeader title={t('landingEdit.features')} subtitle={limitNote(LANDING_LIMITS.features)} />
        <TextList
          items={draft.features}
          max={LANDING_LIMITS.features}
          onChange={(features) => set('features', features)}
        />
      </Card>

      <Card className="mb-4">
        <CardHeader title={t('landingEdit.tips')} subtitle={limitNote(LANDING_LIMITS.tips)} />
        <RowList
          items={draft.tips}
          max={LANDING_LIMITS.tips}
          onChange={(tips) => set('tips', tips)}
          blank={{ icon: 'snowflake' as LandingIcon, title: '', text: '' }}
          render={(tip, update) => (
            <div className="space-y-2">
              <div className="flex gap-2">
                <IconSelect value={tip.icon} onChange={(icon) => update({ ...tip, icon })} />
                <Input
                  aria-label={t('landingEdit.title')}
                  placeholder={t('landingEdit.title')}
                  maxLength={60}
                  value={tip.title}
                  onChange={(e) => update({ ...tip, title: e.target.value })}
                />
              </div>
              <Textarea
                aria-label={t('landingEdit.text')}
                placeholder={t('landingEdit.text')}
                rows={2}
                maxLength={240}
                value={tip.text}
                onChange={(e) => update({ ...tip, text: e.target.value })}
              />
            </div>
          )}
        />
      </Card>

      <Card className="mb-4">
        <CardHeader title={t('landingEdit.faqs')} subtitle={limitNote(LANDING_LIMITS.faqs)} />
        <RowList
          items={draft.faqs}
          max={LANDING_LIMITS.faqs}
          onChange={(faqs) => set('faqs', faqs)}
          blank={{ q: '', a: '' }}
          render={(faq, update) => (
            <div className="space-y-2">
              <Input
                aria-label={t('landingEdit.question')}
                placeholder={t('landingEdit.question')}
                maxLength={160}
                value={faq.q}
                onChange={(e) => update({ ...faq, q: e.target.value })}
              />
              <Textarea
                aria-label={t('landingEdit.answer')}
                placeholder={t('landingEdit.answer')}
                rows={2}
                maxLength={800}
                value={faq.a}
                onChange={(e) => update({ ...faq, a: e.target.value })}
              />
            </div>
          )}
        />
      </Card>

      <Card className="mb-4">
        {save.error && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <Button full size="lg" loading={save.isPending} onClick={() => save.mutate()}>
          {t('app.save')}
        </Button>
      </Card>

      <Reviews reviews={live.reviews} onStored={store} />
    </>
  );
}

const limitNote = (max: number) => `${t('landingEdit.max')} ${formatNumber(max)}`;

function IconSelect({ value, onChange }: { value: LandingIcon; onChange: (icon: LandingIcon) => void }) {
  return (
    <Select
      aria-label={t('landingEdit.icon')}
      value={value}
      onChange={(e) => onChange(e.target.value as LandingIcon)}
      className="w-32 shrink-0"
    >
      {LANDING_ICONS.map((icon) => (
        <option key={icon} value={icon}>
          {t(`landingEdit.icon.${icon}` as DictKey)}
        </option>
      ))}
    </Select>
  );
}

/** A list of structured rows, each with a remove button, and an add at the end. */
function RowList<T>({
  items,
  max,
  onChange,
  blank,
  render,
}: {
  items: T[];
  max: number;
  onChange: (items: T[]) => void;
  blank: T;
  render: (item: T, update: (next: T) => void) => React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        // Rows have no identity until saved; the index is the identity here.
        <div key={index} className="flex items-start gap-2 rounded-xl bg-muted/60 p-3">
          <div className="min-w-0 flex-1">
            {render(item, (next) => onChange(items.map((existing, i) => (i === index ? next : existing))))}
          </div>
          <Button
            variant="quiet"
            size="icon"
            aria-label={t('landingEdit.remove')}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {items.length < max && (
        <Button variant="outline" full onClick={() => onChange([...items, blank])}>
          <Plus className="h-4 w-4" />
          {t('landingEdit.add')}
        </Button>
      )}
    </div>
  );
}

function TextList({ items, max, onChange }: { items: string[]; max: number; onChange: (items: string[]) => void }) {
  return (
    <RowList
      items={items}
      max={max}
      onChange={onChange}
      blank=""
      render={(item, update) => (
        <Input aria-label={t('landingEdit.text')} maxLength={160} value={item} onChange={(e) => update(e.target.value)} />
      )}
    />
  );
}

/** The photographs at the top of every page. Sent as soon as they are chosen and confirmed. */
function HeroImages({
  images,
  onStored,
}: {
  images: LandingContent['heroImages'];
  onStored: (data: LandingResponse) => void;
}) {
  const toast = useToast();
  const [chosen, setChosen] = useState<File[]>([]);

  const upload = useMutation({
    mutationFn: () => {
      const data = new FormData();
      chosen.forEach((file) => data.append('images', file));
      return api.upload<LandingResponse>('/owner/landing/hero-images', data);
    },
    onSuccess: (data) => {
      onStored(data);
      setChosen([]);
      toast(t('file.uploaded'));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api.del<LandingResponse>(`/owner/landing/hero-images/${encodeURIComponent(id)}`),
    onSuccess: (data) => {
      onStored(data);
      toast(t('file.removed'));
    },
  });

  return (
    <Card className="mb-4">
      <CardHeader title={t('landingEdit.heroImages')} subtitle={t('landingEdit.heroImagesHint')} />
      <ImagesField
        label={t('landingEdit.heroImages')}
        value={chosen}
        onChange={setChosen}
        existing={images}
        onRemoveExisting={(id) => remove.mutate(id)}
        max={LANDING_LIMITS.heroImages}
        error={
          upload.error ? errorMessage(upload.error) : remove.error ? errorMessage(remove.error) : undefined
        }
      />
      {chosen.length > 0 && (
        <Button full className="mt-3" loading={upload.isPending} onClick={() => upload.mutate()}>
          {t('landingEdit.uploadImages')}
        </Button>
      )}
    </Card>
  );
}

function Reviews({
  reviews,
  onStored,
}: {
  reviews: LandingContent['reviews'];
  onStored: (data: LandingResponse) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [screenshot, setScreenshot] = useState<File[]>([]);

  const add = useMutation({
    mutationFn: () => {
      const data = new FormData();
      data.set('name', name);
      data.set('text', text);
      if (screenshot[0]) data.set('image', screenshot[0]);
      return api.upload<LandingResponse>('/owner/landing/reviews', data);
    },
    onSuccess: (data) => {
      onStored(data);
      setName('');
      setText('');
      setScreenshot([]);
      toast(t('app.saved'));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<LandingResponse>(`/owner/landing/reviews/${id}`),
    onSuccess: (data) => {
      onStored(data);
      toast(t('file.removed'));
    },
  });

  const errors = fieldErrors(add.error);
  const full = reviews.length >= LANDING_LIMITS.reviews;

  return (
    <Card className="mb-4">
      <CardHeader
        title={t('landingEdit.reviews')}
        subtitle={`${t('landingEdit.reviewsHint')} · ${limitNote(LANDING_LIMITS.reviews)}`}
      />

      {reviews.length > 0 && (
        <ul className="mb-4 space-y-2">
          {reviews.map((review) => (
            <li key={review.id} className="flex items-start gap-3 rounded-xl bg-muted/60 p-3">
              {review.image && (
                // eslint-disable-next-line @next/next/no-img-element -- a small thumb of a hosted image
                <img
                  src={review.image.thumbUrl ?? review.image.url}
                  alt=""
                  className="h-16 w-12 shrink-0 rounded-md object-cover"
                />
              )}
              <div className="min-w-0 flex-1 text-sm">
                {review.name && <p className="font-semibold">{review.name}</p>}
                {review.text && <p className="line-clamp-3 text-muted-foreground">{review.text}</p>}
              </div>
              <Button
                variant="quiet"
                size="icon"
                aria-label={t('landingEdit.remove')}
                loading={remove.isPending && remove.variables === review.id}
                onClick={() => remove.mutate(review.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <div className="rounded-xl border border-dashed border-border p-3">
          {add.error && !Object.keys(errors).length && <Alert tone="danger">{errorMessage(add.error)}</Alert>}
          <Field label={t('landingEdit.reviewName')} htmlFor="reviewName">
            <Input id="reviewName" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('landingEdit.reviewText')} htmlFor="reviewText" error={errors.text}>
            <Textarea
              id="reviewText"
              rows={2}
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <ImagesField
            label={t('landingEdit.reviewImage')}
            value={screenshot}
            onChange={setScreenshot}
            max={1}
          />
          <Button
            full
            className="mt-3"
            loading={add.isPending}
            disabled={!text.trim() && screenshot.length === 0}
            onClick={() => add.mutate()}
          >
            <Plus className="h-4 w-4" />
            {t('landingEdit.addReview')}
          </Button>
        </div>
      )}
    </Card>
  );
}
