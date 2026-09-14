import { Baloo_Da_2, Noto_Serif_Bengali } from 'next/font/google';

/*
 * Display faces for the landing designs, headings only. Body text and every
 * number stay in the app's Noto Sans Bengali, whose digits are drawn for prices
 * (see app/layout.tsx). Declared here so only the public page pulls them in.
 */
export const serifBengali = Noto_Serif_Bengali({
  variable: '--font-landing-serif',
  subsets: ['bengali', 'latin'],
  weight: ['600', '700'],
  display: 'swap',
});

export const roundedBengali = Baloo_Da_2({
  variable: '--font-landing-rounded',
  subsets: ['bengali', 'latin'],
  weight: ['600', '700'],
  display: 'swap',
});
