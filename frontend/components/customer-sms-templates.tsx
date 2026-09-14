'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '@/lib/api';
import { t, type DictKey } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { invalidChars, measure } from '@/lib/gsm7';
import type { CustomerSmsAction } from '@/lib/types';
import { Alert, Card, CardHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
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
  const queryClient = useQueryClient();
  const toast = useToast();
  const { placeholders, maxSegments } = initial.customerSms;

  const [draft, setDraft] = useState(initial.customerSmsTemplates);
  // Which box a chip inserts into: the one last focused.
  const [focused, setFocused] = useState<CustomerSmsAction>('accept');
  const refs = useRef<Partial<Record<CustomerSmsAction, HTMLTextAreaElement | null>>>({});

  const problems = Object.fromEntries(
    ACTIONS.map(({ action }) => [action, problemWith(draft[action], placeholders, maxSegments)])
  ) as Record<CustomerSmsAction, string | null>;
  const valid = Object.values(problems).every((p) => p === null);
  const dirty = ACTIONS.some(({ action }) => draft[action] !== initial.customerSmsTemplates[action]);

  const save = useMutation({
    mutationFn: () => api.patch('/owner/settings', { customerSmsTemplates: draft }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'settings'] });
      toast(t('app.saved'));
    },
  });

  const serverFields = save.error instanceof ApiError ? save.error.fields ?? {} : {};

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
    <Card className="mb-4">
      <CardHeader title={t('settings.customerSms')} subtitle={t('settings.customerSmsHint')} />

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
              {t(`placeholder.${name}` as DictKey) ?? name}
            </span>
          </button>
        ))}
      </div>

      {ACTIONS.map(({ action, label }) => {
        const cost = measure(draft[action]);
        const error = problems[action] ?? translateServer(serverFields[`customerSmsTemplates.${action}`]);
        return (
          <Field key={action} label={t(label)} htmlFor={`template-${action}`} error={error ?? undefined}>
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
          </Field>
        );
      })}

      <Button loading={save.isPending} disabled={!valid || !dirty} onClick={() => save.mutate()}>
        {t('app.save')}
      </Button>
    </Card>
  );
}
