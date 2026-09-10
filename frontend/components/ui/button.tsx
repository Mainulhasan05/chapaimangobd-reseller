import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/*
 * Hand-rolled rather than generated. The palette is ours, the variants map to
 * the actions this app actually has (approve, reject, cancel), and there is no
 * headless dependency for what is a styled button element.
 */
const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-sm hover:brightness-95',
        secondary: 'bg-muted text-foreground border border-border hover:bg-input',
        // A two pixel outline, because one pixel of a quiet border reads as a
        // disabled control rather than a secondary action.
        outline: 'border-2 border-input bg-surface text-foreground hover:bg-muted',
        danger: 'bg-danger text-danger-foreground shadow-sm hover:brightness-110',
        success: 'bg-success text-success-foreground shadow-sm hover:brightness-110',
        ghost: 'text-foreground hover:bg-muted',
      },
      size: {
        sm: 'h-11 px-3.5 text-sm sm:h-9 sm:px-3',
        md: 'h-11 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-11 w-11 sm:h-10 sm:w-10',
      },
      full: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', full: false },
  }
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof button> & { loading?: boolean };

export function Button({
  className,
  variant,
  size,
  full,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(button({ variant, size, full }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className
      )}
    />
  );
}

export { button as buttonVariants };
