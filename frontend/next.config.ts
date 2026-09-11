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
    //
    // Public images are hosted on ImgBB, which serves them from i.ibb.co and
    // renders its thumbnails on the same host. An unlisted host is not a broken
    // image but a hard runtime error, so both ImgBB hostnames are listed even
    // though only one is in use today.
    //
    // The R2 entries stay for deployments that had the public bucket configured
    // before ImgBB, where the URL is still derived from the bucket's base URL
    // and is either an r2.dev subdomain or a custom domain.
    remotePatterns: [
      { protocol: 'https' as const, hostname: 'i.ibb.co' },
      { protocol: 'https' as const, hostname: '**.ibb.co' },
      { protocol: 'https' as const, hostname: '**.r2.dev' },
      ...(publicImageHost ? [{ protocol: 'https' as const, hostname: publicImageHost }] : []),
    ],
  },
};

export default nextConfig;
