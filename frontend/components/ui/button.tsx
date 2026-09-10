import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/*
 * Hand-rolled rather than generated. The palette is ours, the variants map to
 * the actions this app actually has (approve, reject, cancel), and there is no
 * headless dependency for what is a styled button element.
 */
const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:opacity-90',
        secondary: 'bg-muted text-foreground hover:bg-input',
        outline: 'border border-border bg-surface text-foreground hover:bg-muted',
        danger: 'bg-danger text-danger-foreground hover:opacity-90',
        success: 'bg-success text-success-foreground hover:opacity-90',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-9 w-9',
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
