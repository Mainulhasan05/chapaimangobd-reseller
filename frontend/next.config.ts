import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

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
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },
};

export default nextConfig;
