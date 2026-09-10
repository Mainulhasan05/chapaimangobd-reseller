import { redirect } from 'next/navigation';

/**
 * There is no marketing page here. A visitor is either signing in or opening a
 * reseller shop link, and the proxy sends them onward from there.
 */
export default function HomePage() {
  redirect('/login');
}
