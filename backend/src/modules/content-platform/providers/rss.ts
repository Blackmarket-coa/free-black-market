import {
  ContentPlatformProvider,
  ExchangeCodeResult,
  NormalizedPlatformAccount,
  ProviderMetrics,
  ProviderNotSupportedError,
  VerifyAccountResult,
} from "./types"

/**
 * RSS adapter.
 *
 * Stock-bundled: works without any third-party API keys. Verifies post
 * ownership by parsing the RSS feed at the creator's claimed feed URL
 * (stored in `metadata.feed_url`) and confirming the externalPostId (the
 * RSS `<guid>` or `<link>`) is present.
 *
 * Pull-mode metrics are intentionally not supported (RSS feeds don't
 * publish view counts). For engagement-pool eligibility, blogs/podcasts
 * should pair this adapter with `webhook-generic` to push view counts
 * from their analytics pipeline.
 */
export class RssProvider implements ContentPlatformProvider {
  readonly platform = "rss" as const

  buildAuthUrl(): string {
    throw new ProviderNotSupportedError(this.platform, "OAuth")
  }

  async exchangeCode(): Promise<ExchangeCodeResult> {
    throw new ProviderNotSupportedError(this.platform, "OAuth")
  }

  async verifyAccount(account: NormalizedPlatformAccount): Promise<VerifyAccountResult> {
    const feedUrl = (account.metadata as any)?.feed_url
    if (!feedUrl || typeof feedUrl !== "string") {
      return { ok: false, reason: "missing_feed_url" }
    }
    try {
      const res = await fetch(feedUrl, { method: "HEAD" })
      return { ok: res.ok, reason: res.ok ? undefined : `status_${res.status}` }
    } catch (err) {
      return { ok: false, reason: (err as Error).message }
    }
  }

  async verifyPostOwnership(
    account: NormalizedPlatformAccount,
    externalPostId: string
  ): Promise<boolean> {
    const feedUrl = (account.metadata as any)?.feed_url
    if (!feedUrl || typeof feedUrl !== "string") return false
    try {
      const res = await fetch(feedUrl)
      if (!res.ok) return false
      const xml = await res.text()
      // Minimal contains-check; a real implementation would parse XML.
      return xml.includes(externalPostId)
    } catch {
      return false
    }
  }

  async fetchPostMetrics(): Promise<ProviderMetrics> {
    throw new ProviderNotSupportedError(
      this.platform,
      "fetchPostMetrics (RSS feeds do not expose engagement metrics)"
    )
  }
}
