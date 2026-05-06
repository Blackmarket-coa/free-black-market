/**
 * Embed-only layout group: strips storefront chrome (Header/Footer/etc.) so
 * pages under this group render as standalone widgets suitable for being
 * iframed into third-party sites. Frame-ancestors is relaxed at the
 * `next.config.ts` headers() level for the matching path.
 */
export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
