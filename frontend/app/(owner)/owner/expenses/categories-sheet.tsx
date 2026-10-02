'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import type { ExpenseCategory } from '@/lib/types';
import {
  useArchiveExpenseCategoryMutation,
  useCreateExpenseCategoryMutation,
  useGetExpenseCategoriesQuery,
  useRestoreExpenseCategoryMutation,
  useSeedExpenseCategoriesMutation,
} from '@/lib/store/endpoints/cost';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { scopeHint, scopeLabel } from './expense-parts';

/**
 * The categories, managed from the screen they are used on.
 *
 * Put away rather than deleted, because an expense snapshots the name it was
 * filed under and a deleted category would leave last month's report unreadable.
 * The button used to say "বন্ধ করুন" — the word for closing a sheet — and took
 * the category away on one tap with no way back. It now says "সরিয়ে রাখুন",
 * asks first (inline, so a second sheet never stacks on this one), and the
 * ones put away are listed underneath with a way back.
 */
export function CategoriesModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const all = useGetExpenseCategoriesQuery({ includeArchived: true });
  const categories = all.data?.categories ?? [];
  const live = categories.filter((category) => !category.isArchived);
  const archived = categories.filter((category) => category.isArchived);

  const [nameBn, setNameBn] = useState('');
  const [scope, setScope] = useState<ExpenseCategory['scope']>('period');
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const [create, createState] = useCreateExpenseCategoryMutation();
  const [archive, archiveState] = useArchiveExpenseCategoryMutation();
  const [restore, restoreState] = useRestoreExpenseCategoryMutation();
  const [seed, seedState] = useSeedExpenseCategoriesMutation();

  const errors = fieldErrors(createState.error);
  const nameMissing = nameBn.trim().length < 2;

  /** Runs one action with its toast; says whether it worked, so a confirm can stay open on failure. */
  const run = async (action: () => Promise<unknown>, success: string): Promise<boolean> => {
    try {
      await action();
      toast(success);
      return true;
    } catch (error) {
      toast(errorMessage(error), 'danger');
      return false;
    }
  };

  const add = async () => {
    setTried(true);
    if (nameMissing) return;
    try {
      await create({ nameBn: nameBn.trim(), scope }).unwrap();
      toast(tf('expense.categoryCreatedToast', { name: nameBn.trim() }));
      setNameBn('');
      setTried(false);
    } catch {
      // Shown beside the field.
    }
  };

  const nameError = errors.nameBn ?? (tried && nameMissing ? t('app.required') : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('expense.categories')}
      dirty={Boolean(nameBn.trim())}
      // Through the guard, so a half-typed new category is not thrown away unasked.
      footer={<ModalCancel label={t('app.close')} />}
    >
      {all.isLoading ? (
        <p className="mb-4 text-sm text-muted-foreground">{t('app.loading')}</p>
      ) : live.length === 0 ? (
        <div className="mb-4">
          <p className="mb-3 text-sm text-muted-foreground">{t('expense.help')}</p>
          <Button
            full
            loading={seedState.isLoading}
            onClick={() => run(() => seed().unwrap(), t('expense.seededToast'))}
          >
            {t('expense.seedCategories')}
          </Button>
        </div>
      ) : (
        <ul className="mb-4 divide-y divide-border">
          {live.map((category) =>
            confirming === category.id ? (
              <li key={category.id} className="py-3">
                <p className="text-sm font-semibold">
                  {tf('expense.archiveCategoryTitle', { name: category.nameBn })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t('expense.archiveCategoryKeep')}</p>
                <div className="mt-2 flex gap-2 [&>button]:flex-1">
                  <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
                    {t('app.dismiss')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={archiveState.isLoading && archiveState.originalArgs?.id === category.id}
                    onClick={() =>
                      run(
                        () => archive({ id: category.id }).unwrap(),
                        tf('expense.categoryArchivedToast', { name: category.nameBn })
                      ).then((done) => done && setConfirming(null))
                    }
                  >
                    {t('app.archive')}
                  </Button>
                </div>
              </li>
            ) : (
              <li key={category.id} className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{category.nameBn}</p>
                  <p className="text-xs text-muted-foreground">{scopeLabel(category.scope)}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(category.id)}>
                  {t('app.archive')}
                </Button>
              </li>
            )
          )}
        </ul>
      )}

      {archived.length > 0 && (
        <section className="mb-4 border-t border-border pt-4">
          <h3 className="mb-1 text-sm font-bold">{t('expense.archivedCategories')}</h3>
          <ul className="divide-y divide-border">
            {archived.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-muted-foreground">{category.nameBn}</p>
                  <p className="text-xs text-muted-foreground">{scopeLabel(category.scope)}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  loading={restoreState.isLoading && restoreState.originalArgs?.id === category.id}
                  onClick={() =>
                    run(
                      () => restore({ id: category.id }).unwrap(),
                      tf('expense.categoryRestoredToast', { name: category.nameBn })
                    )
                  }
                >
                  {t('app.restore')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-bold">{t('expense.newCategory')}</h3>

        <Field label={t('expense.categoryName')} htmlFor="categoryName" error={nameError} required>
          <Input
            id="categoryName"
            value={nameBn}
            invalid={Boolean(nameError)}
            onChange={(event) => setNameBn(event.target.value)}
          />
        </Field>

        <Field
          label={t('expense.categoryScope')}
          htmlFor="categoryScope"
          hint={scopeHint(scope)}
          error={errors.scope}
        >
          <Select
            id="categoryScope"
            value={scope}
            onChange={(event) => setScope(event.target.value as ExpenseCategory['scope'])}
          >
            <option value="period">{scopeLabel('period')}</option>
            <option value="order">{scopeLabel('order')}</option>
            <option value="both">{scopeLabel('both')}</option>
          </Select>
        </Field>

        {createState.error && !Object.keys(errors).length && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {errorMessage(createState.error)}
          </p>
        )}

        <Button full variant="outline" loading={createState.isLoading} onClick={add}>
          <Plus className="h-4 w-4" />
          {t('expense.newCategory')}
        </Button>
      </section>
    </Modal>
  );
}
