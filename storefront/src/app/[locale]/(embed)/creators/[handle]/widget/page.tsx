import { notFound } from "next/navigation"
import { getCreatorByHandle } from "@/lib/data/creator"

/**
 * Embeddable creator widget.
 *
 * Designed to be iframed into third-party sites (TikTok bio link pages,
 * blogs, podcasts, Blackout). Rendered without site chrome. The
 * `frame-ancestors *` header is set on `/[locale]/creators/[handle]/widget`
 * via `next.config.ts`. Origin allowlisting can be enforced per affiliate
 * link via `AffiliateLink.allowed_origins`.
 */
export default async function CreatorWidgetPage({
  params,
}: {
  params: Promise<{ handle: string; locale: string }>
}) {
  const { handle, locale } = await params
  const creator = await getCreatorByHandle(handle)
  if (!creator) return notFound()

  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
        background: "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 16,
          background: "#fff",
          color: "#111",
          borderRadius: 12,
          border: "1px solid #e5e5e5",
          maxWidth: 480,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              background: "#f3f3f3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 600,
              fontSize: 18,
            }}
          >
            {creator.handle.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <strong style={{ fontSize: 16 }}>@{creator.handle}</strong>
              {creator.verified ? (
                <span
                  style={{
                    background: "#3b82f6",
                    color: "#fff",
                    padding: "2px 6px",
                    borderRadius: 4,
                    fontSize: 10,
                  }}
                >
                  Verified
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: 12, color: "#666" }}>
              {creator.total_followers.toLocaleString()} followers
              {creator.niches.length > 0
                ? ` · ${creator.niches.slice(0, 3).join(", ")}`
                : ""}
            </div>
          </div>
        </div>

        {creator.bio ? (
          <div style={{ fontSize: 14, lineHeight: 1.4 }}>{creator.bio}</div>
        ) : null}

        <a
          href={`/${locale}/creators/${creator.handle}`}
          target="_top"
          style={{
            display: "block",
            textAlign: "center",
            padding: "10px 16px",
            background: "#111",
            color: "#fff",
            textDecoration: "none",
            borderRadius: 8,
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          Shop my picks →
        </a>
      </div>
    </div>
  )
}
