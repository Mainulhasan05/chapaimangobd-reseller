'use client';

import { useState } from 'react';
import { Copy, ExternalLink, Share2 } from 'lucide-react';
import { shareLink, copyText } from '@/lib/share';
import { t } from '@/lib/i18n/bn';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/layout';

/**
 * The shop URL, built in the browser so it matches whatever host the reseller is
 * actually on. Server rendering it would bake in the deploy-time origin, which
 * is wrong the moment anyone uses a custom domain.
 */
export function useShopUrl(slug: string | undefined): string {
  if (!slug) return '';
  if (typeof window === 'undefined') return `/r/${slug}`;
  return `${window.location.origin}/r/${slug}`;
}

/**
 * Share, then copy, then tell the user it failed.
 *
 * This business runs on links pasted into chat apps, so the native share sheet
 * is the shortest path from here to a customer. Everything reports its outcome:
 * the old copy button called an unguarded `navigator.clipboard.writeText`, which
 * rejects on an insecure origin and on the older Android browsers this audience
 * uses, and said nothing either way.
 */
export function ShareShopButton({
  url,
  shopName,
  full,
  size = 'md',
}: {
  url: string;
  shopName?: string;
  full?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      full={full}
      size={size}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await shareLink({
            url,
            title: shopName,
            text: t('shop.shareMessage'),
          });
          if (result === 'copied') toast(t('shop.linkCopied'));
          if (result === 'failed') toast(t('app.copyFailed'), 'danger');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Share2 className="h-4 w-4" />
      {t('shop.shareLink')}
    </Button>
  );
}

/** The link, the share button, and the two ways round it. */
export function ShareShopCard({ url, shopName }: { url: string; shopName?: string }) {
  const toast = useToast();

  return (
    <Card>
      <CardHeader title={t('shop.yourLink')} subtitle={t('shop.shareHelp')} />

      <code className="scroll-x mb-3 block rounded-lg bg-muted px-3 py-2 text-sm">{url}</code>

      <div className="flex flex-col gap-2 sm:flex-row">
        <ShareShopButton url={url} shopName={shopName} full />

        <Button
          variant="outline"
          full
          onClick={async () => {
            const copied = await copyText(url);
            toast(copied ? t('shop.linkCopied') : t('app.copyFailed'), copied ? 'success' : 'danger');
          }}
        >
          <Copy className="h-4 w-4" />
          {t('app.copy')}
        </Button>

        <a href={url} target="_blank" rel="noreferrer" className="sm:shrink-0">
          <Button variant="ghost" full>
            <ExternalLink className="h-4 w-4" />
            {t('shop.orderNow')}
          </Button>
        </a>
      </div>
    </Card>
  );
}
