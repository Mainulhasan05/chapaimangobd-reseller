/**
 * The chart palette, and the reason each value is what it is.
 *
 * This is one ordinal ramp in the brand hue, not a set of unrelated colours. The
 * fulfilment stages it paints are a progression, so the encoding is magnitude,
 * light to dark, rather than identity. The steps came out of the palette
 * validator rather than out of a colour picker, and pass its four ordinal checks
 * against a white chart surface:
 *
 *   lightness monotone   steps read light to dark
 *   adjacent lightness   every gap at least 0.06, so neighbours stay separable
 *   light-end contrast   2.1:1, clear of the surface behind it
 *   single hue           23 degrees of spread, one colour family
 *
 * An earlier ramp starting at a prettier pale amber failed the light end at
 * 1.44:1: the first segment of a stacked bar was almost invisible on white.
 *
 * Changing any of these means re-running the validator, not eyeballing it.
 */
export const RAMP = ['#e6a826', '#d38a00', '#bd6e00', '#a25500', '#814200'] as const;

/**
 * The single series colour for a trend chart. The mid step, which carries enough
 * contrast for a 2px stroke without going so dark it reads as ink rather than data.
 */
export const SERIES = RAMP[2];

/** Recessive chrome: one step off the surface, never competing with the data. */
export const GRID = 'oklch(0.9 0.01 90)';

/**
 * The order stages a pipeline bar paints, dark end last. Cancelled and returned
 * are deliberately absent: they are not stages on the way to delivered, and
 * mixing an outcome into a progression makes the bar mean two things at once.
 */
export const PIPELINE_STAGES = [
  'confirmed',
  'accepted',
  'packed',
  'shipped',
  'delivered',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
