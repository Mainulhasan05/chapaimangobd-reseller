import { cn } from '@/lib/utils';

/*
 * One field shell, many fillings.
 *
 * Every text box, select, date box and composite field in the app is the same
 * hairline box with the same radius, defined once as `.control` in globals.css.
 * The parts that vary sit inside it: a trailing icon, a unit, or the small
 * button that belongs to the field rather than to the form.
 *
 * `text-base` rather than `text-sm` below `sm`: iOS Safari zooms the whole page
 * when a focused input is under 16px, and the user then has to pinch back out to
 * see the form they are filling in.
 */

/**
 * The bare input that sits inside a shell. It draws no box of its own, because
 * the shell already drew one and two boxes on one field is what makes a form
 * look like it was assembled rather than designed.
 *
 * The two `inherit` rules matter more than they look. A browser's own stylesheet
 * resets an input's font shorthand, which silently drops `tabular-nums` and
 * `uppercase` set on an ancestor. Callers put those on the field, so the input
 * has to be told to take them.
 */
const bare =
  'peer w-full min-w-0 bg-transparent px-3 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:text-muted-foreground sm:text-sm [font-variant-numeric:inherit] [text-transform:inherit]';

/** Wraps the shell so width and font utilities from a caller land on the box. */
function shell(className?: string) {
  return cn('control flex items-stretch overflow-hidden', className);
}

type FieldExtras = {
  /**
   * A control that belongs to this field, pinned to its right edge inside the
   * box: "Add description", "Set meeting room", "Add". Use `InlineAction`.
   */
  action?: React.ReactNode;
  /** A trailing glyph, such as the calendar on a date box. Never interactive. */
  icon?: React.ComponentType<{ className?: string }>;
  /**
   * Arbitrary non-interactive content at the right edge: a digit counter, a
   * validity tick, a unit. Use `action` instead for anything clickable, so the
   * two never end up competing for the same corner.
   */
  trailing?: React.ReactNode;
  /** A fixed mark before the value, such as a currency sign. */
  prefix?: React.ReactNode;
  /** Marks the box invalid, which `.control` paints. `Field` passes this for you. */
  invalid?: boolean;
};

export function Input({
  className,
  action,
  icon: Icon,
  prefix,
  trailing,
  invalid,
  ...props
}: React.ComponentProps<'input'> & FieldExtras) {
  return (
    <div className={shell(className)} data-invalid={invalid || undefined}>
      {prefix && (
        <span
          aria-hidden
          className="flex items-center pl-3 text-sm font-medium text-muted-foreground"
        >
          {prefix}
        </span>
      )}
      <input className={cn(bare, 'h-11 sm:h-10', prefix && 'pl-1.5')} {...props} />
      {trailing && (
        <span aria-hidden className="flex shrink-0 items-center pr-3">
          {trailing}
        </span>
      )}
      {Icon && (
        <span aria-hidden className="flex shrink-0 items-center pr-3 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
      )}
      {action}
    </div>
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: React.ComponentProps<'textarea'> & { invalid?: boolean }) {
  return (
    <div className={shell(cn('block', className))} data-invalid={invalid || undefined}>
      <textarea className={cn(bare, 'block min-h-20 resize-y py-2.5')} {...props} />
    </div>
  );
}

/**
 * A native select, styled as the shell directly rather than wrapped in one.
 *
 * The element is the control here, so there is nothing to wrap: wrapping it
 * would put a box around a box and break the operating system's own dropdown
 * positioning on Android, which anchors to the select itself.
 */
export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'control h-11 w-full px-3 text-base text-foreground outline-none disabled:text-muted-foreground sm:h-10 sm:text-sm',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/**
 * The button that lives inside a field.
 *
 * It is the reference design's one real idea: an action that only makes sense
 * for this field sits in the field, not under it and not in the form's footer.
 * It is drawn as a quiet pill so it reads as part of the box rather than as the
 * form's primary action, which is always the filled button at the bottom.
 */
export function InlineAction({
  className,
  children,
  ...props
}: React.ComponentProps<'button'>) {
  return (
    <span className="flex items-center py-1.5 pr-1.5">
      <button
        type="button"
        className={cn(
          'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
      </button>
    </span>
  );
}

/** A fixed unit or suffix pinned inside the right of a field, such as a currency. */
export function InlineNote({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center whitespace-nowrap pr-3 text-sm text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * An icon-only control inside a field, such as a password reveal.
 *
 * Square rather than a pill, because it carries a glyph and not a word, and a
 * pill drawn around a single icon reads as a second, competing field boundary.
 */
export function InlineIconButton({
  className,
  children,
  ...props
}: React.ComponentProps<'button'>) {
  return (
    <span className="flex shrink-0 items-center pr-1.5">
      <button
        type="button"
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          className
        )}
        {...props}
      >
        {children}
      </button>
    </span>
  );
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn('mb-1.5 block text-[0.8125rem] font-semibold text-foreground', className)}
      {...props}
    />
  );
}

/**
 * One field, its label, its hint and its error. The error slot always renders the
 * server field message when there is one, so validation the API performs shows up
 * next to the input rather than as a banner the user has to map back themselves.
 *
 * A row of fields that belong together, like date and time and duration, is a
 * `FieldRow` of these rather than three separate blocks, so the labels sit on one
 * baseline and the boxes share a bottom edge.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 min-w-0', className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </Label>
      )}
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

/**
 * Fields that are read as one thing, side by side from `sm` up.
 *
 * Below that they stack, because three boxes across a 360px screen leaves each
 * one too narrow to show its own value.
 */
export function FieldRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-3 [&>*]:mb-0', className)}>{children}</div>
  );
}

/** A line of explanation under a group, in the reference's smallest grey. */
export function FieldNote({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 mt-2 text-xs text-muted-foreground">{children}</p>;
}

/**
 * A currency input. Latin digits only, because the value is parsed back.
 *
 * The taka mark is a prefix, not a trailing glyph: Bengali writes the sign
 * before the amount, and a reader scanning a column of prices needs it at the
 * start of the number rather than after a variable number of digits.
 */
export function MoneyInput({ className, ...props }: React.ComponentProps<'input'> & FieldExtras) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      step="0.01"
      min="0"
      className={cn('tabular', className)}
      prefix="৳"
      {...props}
    />
  );
}
