'use client';

import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, PencilLine, Plus, Trash2 } from 'lucide-react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tf, type DictKey } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isLandingTemplate, LANDING_ICONS, LANDING_LIMITS, LANDING_TEMPLATES } from '@/lib/landing';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useUrlState } from '@/lib/use-url-state';
import type { LandingContent, LandingIcon, LandingTemplate, PublicShop } from '@/lib/types';
import {
  useAddLandingReviewMutation,
  useGetLandingQuery,
  useGetProductsQuery,
  useRemoveLandingHeroImageMutation,
  useRemoveLandingReviewMutation,
  useUpdateLandingMutation,
  useUploadLandingHeroImagesMutation,
  type LandingUpdate,
} from '@/lib/store/endpoints/catalog';
import { Alert, Badge, Card, CardHeader, ErrorState, PageHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Field, FieldRow, Input, Select, Textarea, focusFirstInvalid } from '@/components/ui/form';
import { ImagesField } from '@/components/ui/images-field';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmented } from '@/components/ui/toolbar';
import { useToast } from '@/components/ui/toast';
import { LandingPage } from '@/components/landing/templates';

/**
 * The owner's editor for the content every public shop page is drawn from.
 *
 * Written once for every reseller. The design each page uses is the reseller's
 * choice and the contact details are theirs; everything a customer reads about
 * the mangoes themselves comes from here. See backend domain/landing.js.
 *
 * Text is edited as a draft and saved together from the bar pinned to the
 * bottom, which says when there is something unsaved. Photos and reviews are
 * sent the moment they are added, for the same reason the brand logo is: a
 * picture has to reach the image host before there is anything to save. Each
 * card says which of the two it is.
 *
 * Beside the form (or behind the "প্রিভিউ" tab on a phone) is the real page,
 * drawn by the same components a customer gets, from the draft as typed.
 */

export default function OwnerLandingPage() {
  const landing = useGetLandingQuery();

  if (!landing.data) {
    return (
      <>
        <PageHeader title={t('nav.landing')} subtitle={t('landingEdit.subtitle')} />
        {landing.isError ? (
          <ErrorState onRetry={() => landing.refetch()} isRetrying={landing.isFetching} error={landing.error} />
        ) : (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        )}
      </>
    );
  }

  return <LandingEditor live={landing.data.landing} />;
}

/** The text half, held as typed. The rating stays a string until it is sent. */
type Draft = Omit<LandingContent, 'heroImages' | 'reviews' | 'rating'> & { rating: string };

/** The lists the save filters, whose server errors must be mapped back to rows. */
type ListKey = 'badges' | 'whyUs' | 'features' | 'tips' | 'faqs';

const draftOf = (content: LandingContent): Draft => ({
  headline: content.headline,
  subtitle: content.subtitle,
  videoUrl: content.videoUrl,
  rating: content.rating == null ? '' : String(content.rating),
  customerCount: content.customerCount,
  deliveryNote: content.deliveryNote,
  guaranteeNote: content.guaranteeNote,
  badges: content.badges,
  whyUs: content.whyUs,
  features: content.features,
  tips: content.tips,
  faqs: content.faqs,
});

/*
 * Which rows are sent: a wholly empty row is an "add" that was never used and
 * is dropped; a half-filled one is a mistake, caught before saving. The kept
 * indices travel with the payload so a server error on sent row 2 lands on the
 * draft row it came from.
 */
const keepBadge = (b: Draft['badges'][number]) => Boolean(b.label.trim());
const keepText = (item: string) => Boolean(item.trim());
const keepTip = (tip: Draft['tips'][number]) => Boolean(tip.title.trim() || tip.text.trim());
const keepFaq = (faq: Draft['faqs'][number]) => Boolean(faq.q.trim() || faq.a.trim());

function indicesKept<T>(items: T[], keep: (item: T) => boolean): number[] {
  return items.flatMap((item, index) => (keep(item) ? [index] : []));
}

function payloadOf(draft: Draft): { body: LandingUpdate; sent: Record<ListKey, number[]> } {
  const sent: Record<ListKey, number[]> = {
    badges: indicesKept(draft.badges, keepBadge),
    whyUs: indicesKept(draft.whyUs, keepText),
    features: indicesKept(draft.features, keepText),
    tips: indicesKept(draft.tips, keepTip),
    faqs: indicesKept(draft.faqs, keepFaq),
  };
  return {
    sent,
    body: {
      headline: draft.headline,
      subtitle: draft.subtitle,
      videoUrl: draft.videoUrl.trim(),
      rating: draft.rating.trim() === '' ? null : Number(draft.rating),
      customerCount: draft.customerCount,
      deliveryNote: draft.deliveryNote,
      guaranteeNote: draft.guaranteeNote,
      badges: sent.badges.map((i) => draft.badges[i]),
      whyUs: sent.whyUs.map((i) => draft.whyUs[i]),
      features: sent.features.map((i) => draft.features[i]),
      tips: sent.tips.map((i) => draft.tips[i]),
      faqs: sent.faqs.map((i) => draft.faqs[i]),
    },
  };
}

/** Half-filled rows and a bad rating, keyed `tips.1.text`, `faqs.0.a`, `rating`. */
function problemsOf(draft: Draft): Record<string, string> {
  const out: Record<string, string> = {};
  const rating = draft.rating.trim();
  if (rating !== '' && !(Number(rating) >= 0 && Number(rating) <= 5)) out.rating = t('landingEditor.ratingInvalid');
  draft.tips.forEach((tip, i) => {
    if (!keepTip(tip)) return;
    if (!tip.title.trim()) out[`tips.${i}.title`] = t('landingEditor.rowIncomplete');
    if (!tip.text.trim()) out[`tips.${i}.text`] = t('landingEditor.rowIncomplete');
  });
  draft.faqs.forEach((faq, i) => {
    if (!keepFaq(faq)) return;
    if (!faq.q.trim()) out[`faqs.${i}.q`] = t('landingEditor.rowIncomplete');
    if (!faq.a.trim()) out[`faqs.${i}.a`] = t('landingEditor.rowIncomplete');
  });
  return out;
}

function LandingEditor({ live }: { live: LandingContent }) {
  const toast = useToast();
  const editorRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useUrlState({ tab: 'edit', template: 'bagan' });
  const template = isLandingTemplate(view.template) ? view.template : 'bagan';

  const [baseline, setBaseline] = useState<Draft>(() => draftOf(live));
  const [draft, setDraft] = useState<Draft>(baseline);
  const [tried, setTried] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const sentRef = useRef<Record<ListKey, number[]> | null>(null);

  const [updateLanding, saving] = useUpdateLandingMutation();
  const serverErrors = fieldErrors(saving.error);
  const problems = problemsOf(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useUnsavedChanges(dirty || reviewPending);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  /** A row field's message: what is missing once Save was tried, or what the server said. */
  const rowError = (list: ListKey, index: number, field?: string) => {
    const local = field ? problems[`${list}.${index}.${field}`] : undefined;
    if (tried && local) return local;
    const sentIndex = sentRef.current?.[list].indexOf(index) ?? -1;
    if (sentIndex < 0) return undefined;
    return (
      (field ? serverErrors[`${list}.${sentIndex}.${field}`] : undefined) ??
      serverErrors[`${list}.${sentIndex}`]
    );
  };

  const save = async () => {
    setTried(true);
    if (Object.keys(problems).length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(editorRef.current));
      return;
    }
    const snapshot = draft;
    const { body, sent } = payloadOf(snapshot);
    sentRef.current = sent;
    try {
      const { landing } = await updateLanding(body).unwrap();
      // What was saved becomes the new "nothing to save", including the empty
      // rows the save dropped, so the form matches the page. Anything typed
      // while the request was in flight is a newer draft (a new object) and is
      // kept: it simply stays unsaved against the new baseline.
      const fresh = draftOf(landing);
      setBaseline(fresh);
      setDraft((current) => (current === snapshot ? fresh : current));
      setTried(false);
      toast(t('landingEdit.saved'));
    } catch (error) {
      if (Object.keys(fieldErrors(error)).length > 0) {
        requestAnimationFrame(() => focusFirstInvalid(editorRef.current));
      } else {
        toast(errorMessage(error), 'danger');
      }
    }
  };

  const problemCount = tried ? Object.keys(problems).length : 0;
  const barError =
    problemCount > 0
      ? tf('app.fieldsMissing', { count: formatNumber(problemCount) })
      : Object.keys(serverErrors).length > 0
        ? t('app.fixFields')
        : null;

  return (
    <>
      <PageHeader title={t('nav.landing')} subtitle={t('landingEdit.subtitle')} />

      {/* On a phone the form and the page take turns; side by side from `lg`. */}
      <div className="mb-4 lg:hidden">
        <Segmented
          label={t('landingEditor.tabs')}
          value={view.tab === 'preview' ? 'preview' : 'edit'}
          onChange={(tab) => setView({ tab })}
          options={[
            { value: 'edit', label: t('landingEditor.tabEdit') },
            { value: 'preview', label: t('landingEditor.tabPreview') },
          ]}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
        <div ref={editorRef} className={cn('min-w-0', view.tab === 'preview' && 'hidden lg:block')}>
          <HeroImages images={live.heroImages} />

          <Card className="mb-4">
            <CardHeader title={t('landingEdit.hero')} subtitle={t('landingEditor.onSave')} />

            <Field label={t('landingEdit.headline')} htmlFor="headline" error={serverErrors.headline}>
              <Input
                id="headline"
                maxLength={120}
                value={draft.headline}
                onChange={(e) => set('headline', e.target.value)}
              />
            </Field>
            <Field label={t('landingEdit.subtitleField')} htmlFor="subtitle" error={serverErrors.subtitle}>
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
              error={serverErrors.videoUrl}
            >
              {/* Any text; see docs/adr/0020 and the note on the shop form. */}
              <Input
                id="videoUrl"
                inputMode="url"
                placeholder="youtu.be/..."
                value={draft.videoUrl}
                onChange={(e) => set('videoUrl', e.target.value)}
              />
            </Field>
            <FieldRow className="mb-1 sm:grid-cols-2">
              <Field
                label={t('landingEdit.rating')}
                htmlFor="rating"
                error={serverErrors.rating ?? (tried ? problems.rating : undefined)}
              >
                <Input
                  id="rating"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={5}
                  step={0.1}
                  value={draft.rating}
                  invalid={Boolean(serverErrors.rating ?? (tried && problems.rating))}
                  onChange={(e) => set('rating', e.target.value)}
                />
              </Field>
              <Field label={t('landingEdit.customerCount')} htmlFor="customerCount" error={serverErrors.customerCount}>
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

            <Field label={t('landingEdit.deliveryNote')} htmlFor="deliveryNote" error={serverErrors.deliveryNote}>
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
              error={serverErrors.guaranteeNote}
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

          <ListCard title={t('landingEdit.badges')} max={LANDING_LIMITS.badges}>
            <RowList
              items={draft.badges}
              max={LANDING_LIMITS.badges}
              onChange={(badges) => set('badges', badges)}
              blank={{ icon: 'check' as LandingIcon, label: '' }}
              rowError={(index) => rowError('badges', index, 'label')}
              render={(badge, update, index) => (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <IconSelect value={badge.icon} onChange={(icon) => update({ ...badge, icon })} />
                  <Input
                    aria-label={`${t('landingEditor.badgeText')} — ${tf('landingEditor.rowNumber', { n: formatNumber(index + 1) })}`}
                    placeholder={t('landingEditor.badgeText')}
                    maxLength={40}
                    value={badge.label}
                    onChange={(e) => update({ ...badge, label: e.target.value })}
                  />
                </div>
              )}
            />
          </ListCard>

          <ListCard title={t('landingEdit.whyUs')} max={LANDING_LIMITS.whyUs}>
            <TextList
              items={draft.whyUs}
              max={LANDING_LIMITS.whyUs}
              onChange={(whyUs) => set('whyUs', whyUs)}
              rowError={(index) => rowError('whyUs', index)}
            />
          </ListCard>

          <ListCard title={t('landingEdit.features')} max={LANDING_LIMITS.features}>
            <TextList
              items={draft.features}
              max={LANDING_LIMITS.features}
              onChange={(features) => set('features', features)}
              rowError={(index) => rowError('features', index)}
            />
          </ListCard>

          <ListCard title={t('landingEdit.tips')} max={LANDING_LIMITS.tips}>
            <RowList
              items={draft.tips}
              max={LANDING_LIMITS.tips}
              onChange={(tips) => set('tips', tips)}
              blank={{ icon: 'snowflake' as LandingIcon, title: '', text: '' }}
              rowError={(index) => rowError('tips', index, 'title') ?? rowError('tips', index, 'text')}
              render={(tip, update, index) => (
                <div className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <IconSelect value={tip.icon} onChange={(icon) => update({ ...tip, icon })} />
                    <Input
                      aria-label={t('landingEdit.title')}
                      placeholder={t('landingEdit.title')}
                      maxLength={60}
                      value={tip.title}
                      invalid={tried && Boolean(problems[`tips.${index}.title`])}
                      onChange={(e) => update({ ...tip, title: e.target.value })}
                    />
                  </div>
                  <Textarea
                    aria-label={t('landingEdit.text')}
                    placeholder={t('landingEdit.text')}
                    rows={2}
                    maxLength={240}
                    value={tip.text}
                    invalid={tried && Boolean(problems[`tips.${index}.text`])}
                    onChange={(e) => update({ ...tip, text: e.target.value })}
                  />
                </div>
              )}
            />
          </ListCard>

          <ListCard title={t('landingEdit.faqs')} max={LANDING_LIMITS.faqs}>
            <RowList
              items={draft.faqs}
              max={LANDING_LIMITS.faqs}
              onChange={(faqs) => set('faqs', faqs)}
              blank={{ q: '', a: '' }}
              rowError={(index) => rowError('faqs', index, 'q') ?? rowError('faqs', index, 'a')}
              render={(faq, update, index) => (
                <div className="space-y-2">
                  <Input
                    aria-label={t('landingEdit.question')}
                    placeholder={t('landingEdit.question')}
                    maxLength={160}
                    value={faq.q}
                    invalid={tried && Boolean(problems[`faqs.${index}.q`])}
                    onChange={(e) => update({ ...faq, q: e.target.value })}
                  />
                  <Textarea
                    aria-label={t('landingEdit.answer')}
                    placeholder={t('landingEdit.answer')}
                    rows={2}
                    maxLength={800}
                    value={faq.a}
                    invalid={tried && Boolean(problems[`faqs.${index}.a`])}
                    onChange={(e) => update({ ...faq, a: e.target.value })}
                  />
                </div>
              )}
            />
          </ListCard>

          <Reviews reviews={live.reviews} onPendingChange={setReviewPending} />
        </div>

        <div className={cn('min-w-0 lg:sticky lg:top-20', view.tab !== 'preview' && 'hidden lg:block')}>
          <Preview
            draft={draft}
            live={live}
            template={template}
            onTemplate={(next) => setView({ template: next })}
          />
        </div>
      </div>

      {/*
       * The one Save for the text, pinned above the bottom navigation while the
       * page scrolls, and saying whether there is anything to save. It used to
       * sit at the end of the cards, a screen below most edits. Outside both
       * columns, so it is there on the "প্রিভিউ" tab too, where the owner checks
       * the result and then wants to save it.
       */}
      <div className="above-nav sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mt-4 lg:bottom-4">
        <div className="card elev-3 flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 text-sm" aria-live="polite">
            {barError ? (
              <p className="font-semibold text-danger">{barError}</p>
            ) : dirty ? (
              <p className="flex items-center gap-2 font-semibold">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-warning" />
                {t('app.unsavedBar')}
              </p>
            ) : (
              <p className="text-muted-foreground">{t('landingEditor.allSaved')}</p>
            )}
            {reviewPending && (
              <p className="mt-0.5 text-xs font-medium text-warning-ink">{t('landingEditor.pendingReview')}</p>
            )}
          </div>
          <Button loading={saving.isLoading} disabled={!dirty} onClick={save}>
            {t('app.save')}
          </Button>
        </div>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- preview -- */

/**
 * The page a customer will get, drawn by the same components as `/r/[slug]`,
 * from the draft as it is typed. The owner used to save, open a reseller's shop
 * in another tab and reload it to see a change; in two of the three designs a
 * section is left out entirely when it is empty, which was invisible from here.
 *
 * Products and prices come from the owner's own catalog as a stand-in for a
 * reseller's (their prices are their own), and the order form is a placeholder.
 * Rendering is deferred so typing stays smooth while the page redraws.
 */
function Preview({
  draft,
  live,
  template,
  onTemplate,
}: {
  draft: Draft;
  live: LandingContent;
  template: LandingTemplate;
  onTemplate: (template: LandingTemplate) => void;
}) {
  const products = useGetProductsQuery();
  const deferred = useDeferredValue(draft);

  const shop: PublicShop = useMemo(() => {
    const { body } = payloadOf(deferred);
    return {
      shop: {
        slug: 'preview',
        name: t('landingEditor.sampleShop'),
        phone: '01700000000',
        poweredBy: t('landingEditor.samplePowered'),
      },
      template,
      landing: {
        ...body,
        rating: body.rating != null && body.rating >= 0 && body.rating <= 5 ? body.rating : null,
        heroImages: live.heroImages,
        reviews: live.reviews,
      },
      acceptingOrders: true,
      products: (products.data?.products ?? [])
        .filter((product) => product.isAvailable && product.variants.some((v) => v.isAvailable))
        .slice(0, 4)
        .map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description,
          images: product.images,
          unit: product.unit,
          inStock: true,
          priceHidden: false,
          variants: product.variants
            .filter((v) => v.isAvailable)
            .map((v) => ({
              id: v.id,
              label: v.label,
              content: v.content,
              inStock: true,
              price: v.maxSellPrice ?? v.costPrice,
            })),
        })),
    };
  }, [deferred, live.heroImages, live.reviews, products.data, template]);

  return (
    <section aria-label={t('landingEditor.tabPreview')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Eye aria-hidden className="h-4 w-4" />
          {t('landingEditor.tabPreview')}
        </h2>
        <Segmented
          label={t('landingEditor.template')}
          value={template}
          onChange={onTemplate}
          options={LANDING_TEMPLATES.map((design) => ({ value: design.id, label: t(design.labelKey) }))}
        />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t('landingEditor.previewHint')}</p>
      {/*
       * Its own scroller, so the design's sticky header sticks to the pane and
       * not over the app's own header; `isolate` keeps its z-index inside. Links
       * are inert here: a preview is for looking, not for leaving.
       */}
      <div
        className="isolate h-[75dvh] overflow-y-auto overscroll-contain rounded-2xl border border-border lg:h-[calc(100dvh-11rem)]"
        onClickCapture={(event) => {
          if ((event.target as Element).closest('a')) event.preventDefault();
        }}
      >
        <LandingPage template={template} slug="preview" shop={shop} zones={[]} preview />
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- lists -- */

function ListCard({ title, max, children }: { title: string; max: number; children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <CardHeader
        title={title}
        subtitle={`${t('landingEdit.max')} ${formatNumber(max)} · ${t('landingEditor.onSave')}`}
      />
      {children}
    </Card>
  );
}

function IconSelect({ value, onChange }: { value: LandingIcon; onChange: (icon: LandingIcon) => void }) {
  return (
    <Select
      aria-label={t('landingEdit.icon')}
      value={value}
      onChange={(e) => onChange(e.target.value as LandingIcon)}
      className="w-full sm:w-36 sm:shrink-0"
    >
      {LANDING_ICONS.map((icon) => (
        <option key={icon} value={icon}>
          {t(`landingEdit.icon.${icon}` as DictKey)}
        </option>
      ))}
    </Select>
  );
}

/**
 * A list of structured rows: each with move up, move down and remove under it,
 * and an add at the end. The order is the order the page shows them in, so it
 * has to be changeable without deleting and retyping.
 */
function RowList<T>({
  items,
  max,
  onChange,
  blank,
  render,
  rowError,
}: {
  items: T[];
  max: number;
  onChange: (items: T[]) => void;
  blank: T;
  render: (item: T, update: (next: T) => void, index: number) => React.ReactNode;
  rowError?: (index: number) => string | undefined;
}) {
  const move = (index: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const error = rowError?.(index);
        const position = tf('landingEditor.rowNumber', { n: formatNumber(index + 1) });
        return (
          // Rows have no identity until saved; the index is the identity here.
          <div
            key={index}
            className={cn('rounded-xl bg-muted/60 p-3', error && 'ring-1 ring-danger')}
            data-invalid={error ? true : undefined}
          >
            {render(item, (next) => onChange(items.map((existing, i) => (i === index ? next : existing))), index)}
            {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
            <div className="mt-2 flex items-center gap-1">
              <Button
                variant="quiet"
                size="icon"
                aria-label={`${t('landingEditor.moveUp')} — ${position}`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="quiet"
                size="icon"
                aria-label={`${t('landingEditor.moveDown')} — ${position}`}
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                variant="quiet"
                size="sm"
                className="ml-auto text-danger"
                aria-label={`${t('app.remove')} — ${position}`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" />
                {t('app.remove')}
              </Button>
            </div>
          </div>
        );
      })}
      {items.length < max && (
        <Button variant="outline" full onClick={() => onChange([...items, blank])}>
          <Plus className="h-4 w-4" />
          {t('landingEdit.add')}
        </Button>
      )}
    </div>
  );
}

function TextList({
  items,
  max,
  onChange,
  rowError,
}: {
  items: string[];
  max: number;
  onChange: (items: string[]) => void;
  rowError?: (index: number) => string | undefined;
}) {
  return (
    <RowList
      items={items}
      max={max}
      onChange={onChange}
      blank=""
      rowError={rowError}
      render={(item, update, index) => (
        <Input
          aria-label={`${t('landingEdit.text')} — ${tf('landingEditor.rowNumber', { n: formatNumber(index + 1) })}`}
          maxLength={160}
          value={item}
          onChange={(e) => update(e.target.value)}
        />
      )}
    />
  );
}

/* ---------------------------------------------------- instant: pictures -- */

/**
 * The photographs at the top of every page, sent the moment they are picked.
 * There used to be a separate "upload" button under the picker that was easy to
 * miss, and a picked photo that was never uploaded looked exactly like one that
 * was. A removal asks on the tile first: there is no Save to back out of.
 */
function HeroImages({ images }: { images: LandingContent['heroImages'] }) {
  const toast = useToast();
  const [pending, setPending] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [upload, uploading] = useUploadLandingHeroImagesMutation();
  const [removeImage] = useRemoveLandingHeroImageMutation();
  // Every removal in flight, not just the latest call's: two quick removals must
  // both keep their spinner, and a tile mid-removal must not be removable again.
  const [removing, setRemoving] = useState<string[]>([]);

  const send = async (files: File[]) => {
    setPending(files);
    setError(null);
    const data = new FormData();
    files.forEach((file) => data.append('images', file));
    try {
      await upload({ formData: data }).unwrap();
      setPending([]);
      toast(t('file.uploaded'));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const remove = async (imageId: string) => {
    if (removing.includes(imageId)) return;
    setRemoving((prev) => [...prev, imageId]);
    setError(null);
    try {
      await removeImage({ imageId }).unwrap();
      toast(t('file.removed'));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setRemoving((prev) => prev.filter((id) => id !== imageId));
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader
        title={t('landingEdit.heroImages')}
        subtitle={t('landingEdit.heroImagesHint')}
        action={<Badge tone="primary">{t('landingEditor.instant')}</Badge>}
      />
      <ImagesField
        label={t('landingEdit.heroImages')}
        value={pending}
        existing={images}
        max={LANDING_LIMITS.heroImages}
        uploading={uploading.isLoading}
        busyIds={removing}
        confirmRemove
        error={error ?? undefined}
        onChange={(files) => {
          if (uploading.isLoading) return;
          if (files.length > pending.length) void send(files);
          else setPending(files);
        }}
        onRemoveExisting={(id) => void remove(id)}
      />
      {pending.length > 0 && !uploading.isLoading && (
        <Button variant="outline" full className="mt-3" onClick={() => void send(pending)}>
          {t('products.retryUpload')}
        </Button>
      )}
    </Card>
  );
}

/* ----------------------------------------------------- instant: reviews -- */

function Reviews({
  reviews,
  onPendingChange,
}: {
  reviews: LandingContent['reviews'];
  /** Something typed into the add form and not yet added, for the save bar's warning. */
  onPendingChange: (pending: boolean) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [screenshot, setScreenshot] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const [removing, setRemoving] = useState<LandingContent['reviews'][number] | null>(null);
  const [add, adding] = useAddLandingReviewMutation();
  const [removeReview] = useRemoveLandingReviewMutation();

  const errors = fieldErrors(adding.error);
  const full = reviews.length >= LANDING_LIMITS.reviews;
  const empty = !text.trim() && screenshot.length === 0;

  const update = (next: { name?: string; text?: string; screenshot?: File[] }) => {
    const n = next.name ?? name;
    const tx = next.text ?? text;
    const s = next.screenshot ?? screenshot;
    if (next.name !== undefined) setName(n);
    if (next.text !== undefined) setText(tx);
    if (next.screenshot !== undefined) setScreenshot(s);
    onPendingChange(Boolean(n.trim() || tx.trim() || s.length));
  };

  const submit = async () => {
    setTried(true);
    if (empty) return;
    const data = new FormData();
    data.set('name', name.trim());
    data.set('text', text.trim());
    if (screenshot[0]) data.set('image', screenshot[0]);
    try {
      await add({ formData: data }).unwrap();
      update({ name: '', text: '', screenshot: [] });
      setTried(false);
      toast(t('landingEditor.reviewAdded'));
    } catch {
      // Shown in the form.
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader
        title={t('landingEdit.reviews')}
        subtitle={`${t('landingEdit.reviewsHint')} · ${t('landingEdit.max')} ${formatNumber(LANDING_LIMITS.reviews)}`}
        action={<Badge tone="primary">{t('landingEditor.instant')}</Badge>}
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
                className="text-danger"
                aria-label={`${t('app.remove')} — ${review.name || review.text.slice(0, 30)}`}
                onClick={() => setRemoving(review)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <div className="rounded-xl border border-dashed border-border p-3">
          {adding.error && !Object.keys(errors).length && (
            <Alert tone="danger">{errorMessage(adding.error)}</Alert>
          )}
          <Field label={t('landingEdit.reviewName')} htmlFor="reviewName" hint={t('app.optional')}>
            <Input
              id="reviewName"
              maxLength={60}
              value={name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </Field>
          <Field
            label={t('landingEdit.reviewText')}
            htmlFor="reviewText"
            error={errors.text ?? (tried && empty ? t('landingEditor.reviewEmpty') : undefined)}
          >
            <Textarea
              id="reviewText"
              rows={2}
              maxLength={500}
              value={text}
              invalid={tried && empty}
              onChange={(e) => update({ text: e.target.value })}
            />
          </Field>
          <ImagesField
            label={t('landingEdit.reviewImage')}
            value={screenshot}
            onChange={(files) => update({ screenshot: files })}
            max={1}
          />
          <Button full className="mt-3" loading={adding.isLoading} onClick={submit}>
            <PencilLine className="h-4 w-4" />
            {t('landingEdit.addReview')}
          </Button>
        </div>
      )}

      {removing && (
        <ConfirmSheet
          title={t('landingEditor.removeReviewTitle')}
          tone="danger"
          confirmLabel={t('app.remove')}
          summary={
            <>
              {removing.name && <p className="font-semibold">{removing.name}</p>}
              {removing.text && <p className="line-clamp-3 text-muted-foreground">{removing.text}</p>}
            </>
          }
          consequences={[t('landingEditor.removeReviewLine')]}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await removeReview({ reviewId: removing.id }).unwrap();
            toast(t('landingEditor.reviewRemoved'));
          }}
        />
      )}
    </Card>
  );
}
