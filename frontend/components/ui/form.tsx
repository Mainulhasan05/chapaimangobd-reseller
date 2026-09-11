import { cn } from '@/lib/utils';

/*
 * `text-base` rather than `text-sm` below `sm`: iOS Safari zooms the whole page
 * when a focused input is under 16px, and the user then has to pinch back out to
 * see the form they are filling in.
 */
const control =
  'w-full rounded-xl border-2 border-input bg-surface px-3 py-2 text-base text-foreground transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none disabled:bg-muted disabled:opacity-60 sm:text-sm';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(control, 'h-11 sm:h-10', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-20 resize-y', className)} {...props} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select className={cn(control, 'h-11 sm:h-10', className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label className={cn('mb-1.5 block text-sm font-semibold text-foreground', className)} {...props} />
  );
}

/**
 * One field, its label, its hint and its error. The error slot always renders the
 * server field message when there is one, so validation the API performs shows up
 * next to the input rather than as a banner the user has to map back themselves.
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
    <div className={cn('mb-4', className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </Label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

/** A currency input. Latin digits only, because the value is parsed back. */
export function MoneyInput({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        ৳
      </span>
      <Input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        className={cn('pl-7 tabular', className)}
        {...props}
      />
    </div>
  );
}
