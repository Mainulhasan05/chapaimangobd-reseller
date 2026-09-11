import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/*
 * Hand-rolled rather than generated. The palette is ours, the variants map to
 * the actions this app actually has (approve, reject, cancel), and there is no
 * headless dependency for what is a styled button element.
 *
 * `primary` is blue and carries a white label. It used to be mango with a
 * near-black label, which was the only readable pairing available on amber but
 * read as a highlight rather than a control. Mango did not go away: it is the
 * `brand` variant, for the one or two places where the action is the brand
 * itself, such as sharing a shop link.
 */
const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-[background-color,box-shadow,filter] disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-[0_1px_2px_oklch(0.2_0.02_265/0.08)] hover:brightness-110',
        secondary: 'bg-muted text-foreground border border-border hover:bg-subtle',
        // A hairline, matching the field boxes. It used to be two pixels to stay
        // visible against a heavier palette; against this one it read as a slab.
        outline: 'border border-input bg-surface text-foreground hover:bg-muted',
        danger: 'bg-danger text-danger-foreground elev-1 hover:brightness-110',
        success: 'bg-success text-success-foreground elev-1 hover:brightness-110',
        brand: 'bg-brand text-brand-foreground elev-1 hover:brightness-105',
        ghost: 'text-foreground hover:bg-muted',
        // A link that needs a button's hit area. Used in card headers.
        quiet: 'text-muted-foreground hover:bg-muted hover:text-foreground',
      },
      size: {
        sm: 'h-11 px-3.5 text-sm sm:h-9 sm:px-3',
        md: 'h-11 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-11 w-11 sm:h-10 sm:w-10',
        // For the icon buttons that sit inside a dense table row, where a 44px
        // target would set the row height on its own. Phones get cards instead
        // of that table, so the floor is not being dodged on a touch device.
        'icon-sm': 'h-9 w-9',
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
