'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowUpRight } from 'lucide-react';
import { ApiError, errorMessage } from '@/lib/api';
import { t, tf, tMaybe, type DictKey } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { invalidChars, measure } from '@/lib/gsm7';
import type { CustomerSmsAction } from '@/lib/types';
import { useUpdateSettingsMutation } from '@/lib/store/endpoints/settings';
import { Alert, Card, CardHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, focusFirstInvalid, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * The three texts a customer may be sent, edited by the owner.
 *
 * English only, because a single Bengali letter turns the message into Unicode
 * at 70 characters a segment (docs/adr/0013). The rules here are the server's
 * (`backend/src/domain/customerSms.js`), checked as the owner types so the save
 * rarely has anything to refuse; the server still has the last word and its
 * field errors land under the same boxes.
 *
 * Each box also shows the message as a customer would get it, filled with
 * sample values, because the cost that matters is the filled one: `{trackUrl}`
 * is eight characters in the template and forty in the text.
 */

export type CustomerSmsSettings = {
  customerSmsTemplates: Record<CustomerSmsAction, string>;
  customerSms: {
    available: boolean;
    placeholders: string[];
    maxSegments: number;
    trackUrlConfigured: boolean;
  };
};

const ACTIONS: { action: CustomerSmsAction; label: DictKey }[] = [
  { action: 'accept', label: 'settings.templateAccept' },
  { action: 'ship', label: 'settings.templateShip' },
  { action: 'cancel', label: 'settings.templateCancel' },
];

const MAX_LENGTH = 480;

/**
 * Typical values, Latin like the real ones must be. Lengths are what matter:
 * a real shop name or tracking link may be a little longer or shorter.
 */
const SAMPLE: Record<string, string> = {
  customer: 'Rahima Akter',
  shop: 'Chapai Mango House',
  code: 'CM7K2Q9',
  courier: 'Steadfast',
  trackingId: 'SF123456789',
  trackUrl: 'https://chapaimango.com/track/CM7K2Q9',
  reason: 'Out of stock',
  total: '1450 Tk',
};

/** The template with sample values in, tidied the way the server tidies it. */
function fillSample(template: string): string {
  return template
    .replace(/\{([A-Za-z]+)\}/g, (match, name: string) => SAMPLE[name] ?? match)
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** The same checks, in the same order, as `validateTemplate` on the server. */
function problemWith(template: string, placeholders: string[], maxSegments: number): string | null {
  if (!template.trim()) return t('settings.templateRequired');
  const bad = invalidChars(template);
  if (bad.length > 0) return `${t('settings.templateInvalidChars')} ${bad.join(' ')}`;
  const unknown = [...template.matchAll(/\{([A-Za-z]+)\}/g)]
    .map((m) => m[1])
    .find((name) => !placeholders.includes(name));
  if (unknown) return `${t('settings.templateUnknownPlaceholder')} {${unknown}}`;
  if (template.length > MAX_LENGTH || measure(template).segments > maxSegments) {
    return t('settings.templateTooLong');
  }
  return null;
}

/** A server field message, in Bengali where it is one of the known ones. */
function translateServer(message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (/GSM-7/.test(message)) return `${t('settings.templateInvalidChars')} ${message.split(':').pop()}`;
  if (/Unknown placeholder/.test(message)) {
    return `${t('settings.templateUnknownPlaceholder')} ${message.split(':').pop()}`;
  }
  if (/segments|characters/.test(message)) return t('settings.templateTooLong');
  if (/required/.test(message)) return t('settings.templateRequired');
  return message;
}

export function CustomerSmsTemplates({ initial }: { initial: CustomerSmsSettings }) {
  const toast = useToast();
  const { placeholders, maxSegments } = initial.customerSms;
  const rootRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState(initial.customerSmsTemplates);
  // Which box a chip inserts into: the one last focused.
  const [focused, setFocused] = useState<CustomerSmsAction>('accept');
  const refs = useRef<Partial<Record<CustomerSmsAction, HTMLTextAreaElement | null>>>({});
  const [updateSettings, save] = useUpdateSettingsMutation();
  // What was last saved, so the dirty check follows a save without a refetch.
  const [saved, setSaved] = useState(initial.customerSmsTemplates);

  const problems = Object.fromEntries(
    ACTIONS.map(({ action }) => [action, problemWith(draft[action], placeholders, maxSegments)])
  ) as Record<CustomerSmsAction, string | null>;
  const valid = Object.values(problems).every((p) => p === null);
  const dirty = ACTIONS.some(({ action }) => draft[action] !== saved[action]);

  const serverFields = save.error instanceof ApiError ? (save.error.fields ?? {}) : {};

  const submit = async () => {
    if (!dirty) return;
    if (!valid) {
      // Save stays pressable; it says what is wrong and goes there.
      focusFirstInvalid(rootRef.current);
      toast(t('app.fixFields'), 'danger');
      return;
    }
    try {
      await updateSettings({ customerSmsTemplates: draft }).unwrap();
      setSaved(draft);
      toast(t('smsTemplates.saved'));
    } catch (error) {
      if (!(error instanceof ApiError && error.fields)) toast(errorMessage(error), 'danger');
      else focusFirstInvalid(rootRef.current);
    }
  };

  /** Puts `{name}` where the cursor is, in the box last used. */
  const insert = (name: string) => {
    const box = refs.current[focused];
    const token = `{${name}}`;
    const value = draft[focused];
    const start = box?.selectionStart ?? value.length;
    const end = box?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    setDraft((prev) => ({ ...prev, [focused]: next }));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <Card className="mb-4 scroll-mt-20" id="customer-sms">
      <div ref={rootRef}>
        <CardHeader
          title={t('settings.customerSms')}
          subtitle={t('settings.customerSmsHint')}
          action={
            <Link
              href={'/owner/sms?purpose=customer' as Route}
              className="tap inline-flex items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground"
            >
              {t('smsTemplates.sentLog')}
              <ArrowUpRight aria-hidden className="h-4 w-4" />
            </Link>
          }
        />

        {/* The real reason, rather than a vague "not available". */}
        {!initial.customerSms.available && <Alert tone="warning">{t('customerSms.unavailable')}</Alert>}
        {!initial.customerSms.trackUrlConfigured && (
          <Alert tone="neutral">{t('settings.noTrackUrl')}</Alert>
        )}
        {save.error && Object.keys(serverFields).length === 0 && (
          <Alert tone="danger">{errorMessage(save.error)}</Alert>
        )}

        <p className="mb-2 text-xs text-muted-foreground">{t('settings.placeholders')}</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {placeholders.map((name) => (
            <button
              key={name}
              type="button"
              // Keeps the cursor in the textarea, so the chip lands where it was.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(name)}
              className="tap rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              <span lang="en" className="font-mono">{`{${name}}`}</span>
              <span className="ml-1.5 text-muted-foreground">
                {tMaybe(`placeholder.${name}`, name)}
              </span>
            </button>
          ))}
        </div>

        {ACTIONS.map(({ action, label }) => {
          const cost = measure(draft[action]);
          const error = problems[action] ?? translateServer(serverFields[`customerSmsTemplates.${action}`]);
          const sample = fillSample(draft[action]);
          const filled = measure(sample);
          return (
            <Field key={action} label={t(label)} htmlFor={`template-${action}`} error={error ?? undefined}>
              <div data-invalid={error ? true : undefined}>
                <Textarea
                  id={`template-${action}`}
                  ref={(node: HTMLTextAreaElement | null) => {
                    refs.current[action] = node;
                  }}
                  lang="en"
                  rows={3}
                  maxLength={1000}
                  invalid={Boolean(error)}
                  value={draft[action]}
                  onFocus={() => setFocused(action)}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [action]: event.target.value }))}
                />
              </div>
              <p
                className={cn(
                  'tabular mt-1.5 text-right text-xs',
                  cost.segments > maxSegments || cost.encoding !== 'GSM-7'
                    ? 'text-danger'
                    : 'text-muted-foreground'
                )}
              >
                {t('settings.templateBeforeFill')}: {formatNumber(cost.chars)} {t('customerSms.chars')} ·{' '}
                {formatNumber(cost.segments)}/{formatNumber(maxSegments)} {t('customerSms.segments')}
              </p>
              {sample && (
                <div className="mt-2 rounded-lg bg-muted px-3 py-2">
                  <p className="text-[0.6875rem] font-semibold text-muted-foreground">{t('smsTemplates.sample')}</p>
                  <p lang="en" className="mt-0.5 break-words text-sm">
                    {sample}
                  </p>
                  <p
                    className={cn(
                      'tabular mt-1 text-xs',
                      filled.segments > maxSegments ? 'font-semibold text-danger' : 'text-muted-foreground'
                    )}
                  >
                    {tf('smsTemplates.afterFill', {
                      chars: formatNumber(filled.chars),
                      segments: formatNumber(filled.segments),
                    })}
                  </p>
                </div>
              )}
            </Field>
          );
        })}

        <Button loading={save.isLoading} disabled={!dirty} onClick={submit}>
          {dirty ? t('smsTemplates.save') : t('smsTemplates.unchanged')}
        </Button>
      </div>
    </Card>
  );
}
