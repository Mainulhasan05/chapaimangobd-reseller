import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'h-8 w-8 rounded-[0.6rem]',
  md: 'h-10 w-10 rounded-xl',
  lg: 'h-14 w-14 rounded-2xl',
} as const;

const GLYPH = {
  sm: 'h-[1.125rem] w-[1.125rem]',
  md: 'h-5 w-5',
  lg: 'h-7 w-7',
} as const;

/**
 * The mark.
 *
 * Mango, because this is the one place the brand should be the brand. The rest
 * of the chrome went blue so that interactive things could be told apart from
 * decorative ones, and a logo is the exception that proves the rule: it is the
 * only mango-filled element on a screen that is not a money figure.
 *
 * Drawn rather than loaded. It appears in the header of every authenticated page
 * and on both sign-in screens, and a request for an eight-kilobyte PNG on a slow
 * connection would be the first thing to fail on exactly the devices this app is
 * built for.
 */
export function Logo({
  size = 'sm',
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'elev-1 flex shrink-0 items-center justify-center bg-gradient-to-br from-[oklch(0.84_0.15_85)] to-[oklch(0.74_0.17_62)] text-[oklch(0.24_0.045_60)]',
        SIZES[size],
        className
      )}
    >
      <svg viewBox="0 0 24 24" className={GLYPH[size]} fill="currentColor">
        {/* A mango: an off-centre teardrop with a leaf on the shoulder. */}
        <path d="M15.6 4.2c-1.1-.5-2.4-.4-3.6.2-1.2-.6-2.5-.7-3.6-.2C5.6 5.5 3.9 9 4.5 12.6c.6 3.6 3.3 6.6 6.5 7.3.7.1 1.3.1 2 0 3.2-.7 5.9-3.7 6.5-7.3.6-3.6-1.1-7.1-3.9-8.4Z" />
        <path d="M12.6 4.5c-.4-1.9 1-3.6 3.1-4 .4 2-.9 3.7-2.8 4.2Z" className="opacity-60" />
      </svg>
    </span>
  );
}
