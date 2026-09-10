import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

/** The host serving product images, taken from the R2 public base URL if set. */
const publicImageHost = process.env.R2_PUBLIC_BASE_URL
  ? new URL(process.env.R2_PUBLIC_BASE_URL).hostname
  : null;

const nextConfig: NextConfig = {
  // Stable in Next 16 but off unless asked for. With around thirty routes and
  // Bengali link labels, typed hrefs catch the dead-link class of bug for free.
  typedRoutes: true,

  /**
   * The browser only ever sees this origin. Proxying the API here keeps the auth
   * cookies first-party SameSite=Lax and removes CORS entirely, which also
   * removes the whole class of bugs where a Server Component forgets to forward
   * the cookie header to another origin. See docs/adr/0005.
   *
   * Careful: Next evaluates rewrites at BUILD time and bakes the result into
   * .next/routes-manifest.json. API_ORIGIN must therefore be set when running
   * `next build`, not only when running `next start`. Setting it only at boot
   * leaves the built app pointing at the default and every API call fails with
   * a connection refused that looks like the API being down.
   */
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },

  images: {
    // images.domains is deprecated in Next 16; remotePatterns is the replacement.
    // Product photos come from the R2 bucket's public base URL, which is either an
    // r2.dev subdomain or a custom domain, so both are allowed.
    remotePatterns: [
      { protocol: 'https' as const, hostname: '**.r2.dev' },
      ...(publicImageHost ? [{ protocol: 'https' as const, hostname: publicImageHost }] : []),
    ],
  },
};

export default nextConfig;
