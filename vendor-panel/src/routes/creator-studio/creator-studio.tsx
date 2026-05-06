import { useEffect, useState } from "react"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { backendUrl, getAuthToken } from "../../lib/client"

interface AffiliateLink {
  id: string
  short_code: string
  destination_path: string
  utm_medium: string | null
  utm_campaign: string | null
  click_count: number
  attributed_order_count: number
  status: string
  created_at: string
}

interface Rollup {
  pending_cents: number
  held_cents: number
  approved_cents: number
  paid_cents: number
  reversed_cents: number
  disqualified_cents: number
  total_orders: number
}

interface Attribution {
  id: string
  order_id: string
  source: string
  commission_amount_cents: number
  commission_status: string
  attribution_decided_at: string
  hold_until: string | null
}

interface OpenProgram {
  id: string
  vendor_id: string
  title: string
  program_type: string
  commission_percent: number | null
  commission_flat_cents: number | null
  sponsorship_flat_cents: number | null
  pool_total_cents: number | null
  cookie_window_days: number
  currency_code: string
  requires_kyc: boolean
  min_followers: number | null
  ends_at: string | null
}

interface MyApplication {
  id: string
  program_id: string
  status: string
  pitch: string | null
  decided_at: string | null
  decision_reason: string | null
}

interface MyDeal {
  id: string
  program_id: string
  status: string
  total_attributed_cents: number
  total_paid_out_cents: number
  default_affiliate_link_id: string | null
  effective_until: string | null
}

interface ContentPostRow {
  id: string
  platform: string
  external_post_id: string
  external_url: string
  caption: string | null
  affiliate_link_id: string | null
  verification_status: string
  verified_at: string | null
  qualified: boolean
  disqualified_reason: string | null
}

interface PlatformAccountRow {
  id: string
  platform: string
  external_account_id: string
  handle: string | null
  follower_count: number
  status: string
  inbound_webhook_secret: string | null
  last_synced_at: string | null
}

const formatCents = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100)

const formatDate = (s: string) =>
  new Date(s).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken()
  const url = `${backendUrl.replace(/\/$/, "")}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`${res.status}: ${body || res.statusText}`)
  }
  return (await res.json()) as T
}

export const CreatorStudioPage = () => {
  const [tab, setTab] = useState<
    "dashboard" | "links" | "earnings" | "programs" | "deals" | "posts" | "platforms"
  >("dashboard")
  const [links, setLinks] = useState<AffiliateLink[]>([])
  const [rollup, setRollup] = useState<Rollup | null>(null)
  const [attributions, setAttributions] = useState<Attribution[]>([])
  const [openPrograms, setOpenPrograms] = useState<OpenProgram[]>([])
  const [myApplications, setMyApplications] = useState<MyApplication[]>([])
  const [myDeals, setMyDeals] = useState<MyDeal[]>([])
  const [pitchByProgram, setPitchByProgram] = useState<Record<string, string>>({})
  const [posts, setPosts] = useState<ContentPostRow[]>([])
  const [platformAccounts, setPlatformAccounts] = useState<PlatformAccountRow[]>([])
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  // Generate-link form
  const [productId, setProductId] = useState("")
  const [utmMedium, setUtmMedium] = useState("")
  const [utmCampaign, setUtmCampaign] = useState("")

  // Register-post form
  const [postPlatform, setPostPlatform] = useState("custom")
  const [postExternalId, setPostExternalId] = useState("")
  const [postExternalUrl, setPostExternalUrl] = useState("")
  const [postAffiliateLinkId, setPostAffiliateLinkId] = useState("")
  const [postDealId, setPostDealId] = useState("")

  // Connect-account form
  const [connectPlatform, setConnectPlatform] = useState("custom")
  const [connectExternalId, setConnectExternalId] = useState("")
  const [connectHandle, setConnectHandle] = useState("")
  const [connectFeedUrl, setConnectFeedUrl] = useState("")

  const reload = async () => {
    setLoading(true)
    try {
      const [
        { links: l },
        { rollup: r, attributions: a },
        { open, applications, deals },
        { posts: ps },
        { accounts, available_platforms },
      ] = await Promise.all([
        authedFetch<{ links: AffiliateLink[] }>("/v1/seller/creator/links?limit=50"),
        authedFetch<{ rollup: Rollup; attributions: Attribution[] }>(
          "/v1/seller/creator/earnings?limit=20"
        ),
        authedFetch<{
          open: OpenProgram[]
          applications: MyApplication[]
          deals: MyDeal[]
        }>("/v1/seller/creator/programs"),
        authedFetch<{ posts: ContentPostRow[] }>("/v1/seller/creator/posts"),
        authedFetch<{
          accounts: PlatformAccountRow[]
          available_platforms: string[]
        }>("/v1/seller/creator/platform-accounts"),
      ])
      setLinks(l)
      setRollup(r)
      setAttributions(a)
      setOpenPrograms(open)
      setMyApplications(applications)
      setMyDeals(deals)
      setPosts(ps)
      setPlatformAccounts(accounts)
      setAvailablePlatforms(available_platforms)
    } catch (err) {
      toast.error("Failed to load creator studio data", {
        description: (err as Error).message,
      })
    } finally {
      setLoading(false)
    }
  }

  const registerPost = async () => {
    if (!postExternalId || !postExternalUrl) {
      toast.error("External post id and URL required")
      return
    }
    try {
      const body: Record<string, unknown> = {
        platform: postPlatform,
        external_post_id: postExternalId,
        external_url: postExternalUrl,
      }
      if (postAffiliateLinkId.trim()) body.affiliate_link_id = postAffiliateLinkId.trim()
      if (postDealId.trim()) body.deal_id = postDealId.trim()
      const { post } = await authedFetch<{ post: ContentPostRow }>(
        "/v1/seller/creator/posts",
        { method: "POST", body: JSON.stringify(body) }
      )
      toast.success(
        post.verification_status === "verified"
          ? "Post registered and auto-verified"
          : "Post registered (verification pending)"
      )
      setPostExternalId("")
      setPostExternalUrl("")
      setPostAffiliateLinkId("")
      setPostDealId("")
      await reload()
    } catch (err) {
      toast.error("Register post failed", {
        description: (err as Error).message,
      })
    }
  }

  const connectAccount = async () => {
    if (!connectExternalId.trim()) {
      toast.error("External account id required")
      return
    }
    try {
      const body: Record<string, unknown> = {
        platform: connectPlatform,
        external_account_id: connectExternalId.trim(),
        handle: connectHandle.trim() || null,
      }
      if (connectPlatform === "rss" && connectFeedUrl.trim()) {
        body.metadata = { feed_url: connectFeedUrl.trim() }
      }
      await authedFetch("/v1/seller/creator/platform-accounts", {
        method: "POST",
        body: JSON.stringify(body),
      })
      toast.success("Platform account connected")
      setConnectExternalId("")
      setConnectHandle("")
      setConnectFeedUrl("")
      await reload()
    } catch (err) {
      toast.error("Connect failed", { description: (err as Error).message })
    }
  }

  const beginOAuth = async (platform: string) => {
    try {
      const redirectUri = `${window.location.origin}/creator-studio?oauth_platform=${platform}`
      const result = await authedFetch<{ authUrl: string; state: string }>(
        "/v1/seller/creator/platform-accounts/connect",
        {
          method: "POST",
          body: JSON.stringify({ platform, redirect_uri: redirectUri }),
        }
      )
      window.location.href = result.authUrl
    } catch (err) {
      toast.error("OAuth start failed", { description: (err as Error).message })
    }
  }

  const revokeAccount = async (id: string) => {
    if (!window.confirm("Revoke this platform connection?")) return
    try {
      await authedFetch(`/v1/seller/creator/platform-accounts/${id}`, {
        method: "DELETE",
      })
      toast.success("Account revoked")
      await reload()
    } catch (err) {
      toast.error("Revoke failed", { description: (err as Error).message })
    }
  }

  const applyToProgram = async (programId: string) => {
    const pitch = pitchByProgram[programId]?.trim() || null
    try {
      await authedFetch(`/v1/seller/creator/programs/${programId}/apply`, {
        method: "POST",
        body: JSON.stringify({ pitch }),
      })
      toast.success("Application submitted")
      setPitchByProgram((m) => {
        const next = { ...m }
        delete next[programId]
        return next
      })
      await reload()
    } catch (err) {
      toast.error("Apply failed", { description: (err as Error).message })
    }
  }

  const withdrawApplication = async (programId: string) => {
    try {
      await authedFetch(`/v1/seller/creator/programs/${programId}/apply`, {
        method: "DELETE",
      })
      toast.success("Application withdrawn")
      await reload()
    } catch (err) {
      toast.error("Withdraw failed", { description: (err as Error).message })
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const handleGenerate = async () => {
    try {
      const body: Record<string, unknown> = {}
      if (productId.trim()) body.product_id = productId.trim()
      if (utmMedium.trim()) body.utm_medium = utmMedium.trim()
      if (utmCampaign.trim()) body.utm_campaign = utmCampaign.trim()
      const { link } = await authedFetch<{ link: AffiliateLink }>(
        "/v1/seller/creator/links",
        { method: "POST", body: JSON.stringify(body) }
      )
      toast.success("Link created", {
        description: `Code: ${link.short_code}`,
      })
      setProductId("")
      setUtmMedium("")
      setUtmCampaign("")
      await reload()
    } catch (err) {
      toast.error("Could not create link", {
        description: (err as Error).message,
      })
    }
  }

  const copyShare = async (link: AffiliateLink) => {
    const url = `${backendUrl.replace(/\/$/, "")}/r/${link.short_code}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Share URL copied to clipboard")
    } catch {
      toast.error("Could not copy", { description: url })
    }
  }

  return (
    <Container className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Heading level="h1">Creator Studio</Heading>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={tab === "dashboard" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("dashboard")}
          >
            Dashboard
          </Button>
          <Button
            variant={tab === "programs" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("programs")}
          >
            Find programs ({openPrograms.length})
          </Button>
          <Button
            variant={tab === "deals" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("deals")}
          >
            Deals ({myDeals.length})
          </Button>
          <Button
            variant={tab === "links" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("links")}
          >
            Links
          </Button>
          <Button
            variant={tab === "posts" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("posts")}
          >
            Posts ({posts.length})
          </Button>
          <Button
            variant={tab === "platforms" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("platforms")}
          >
            Platforms ({platformAccounts.length})
          </Button>
          <Button
            variant={tab === "earnings" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("earnings")}
          >
            Earnings
          </Button>
        </div>
      </div>

      {tab === "dashboard" && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Pending" value={formatCents(rollup?.pending_cents ?? 0)} />
          <KpiCard label="Held" value={formatCents(rollup?.held_cents ?? 0)} />
          <KpiCard
            label="Approved (unpaid)"
            value={formatCents(rollup?.approved_cents ?? 0)}
          />
          <KpiCard label="Paid" value={formatCents(rollup?.paid_cents ?? 0)} />
          <KpiCard
            label="Total attributed orders"
            value={String(rollup?.total_orders ?? 0)}
          />
          <KpiCard
            label="Active links"
            value={String(
              links.filter((l) => l.status === "active").length
            )}
          />
          <KpiCard
            label="Total clicks"
            value={String(
              links.reduce((sum, l) => sum + Number(l.click_count), 0)
            )}
          />
          <KpiCard
            label="Reversed"
            value={formatCents(rollup?.reversed_cents ?? 0)}
          />
        </div>
      )}

      {tab === "links" && (
        <div className="flex flex-col gap-4">
          <div className="border border-ui-border-base rounded-md p-4 flex flex-col gap-3">
            <Heading level="h2">Generate a new link</Heading>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="product_id">Product ID (optional)</Label>
                <Input
                  id="product_id"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  placeholder="prod_..."
                />
              </div>
              <div>
                <Label htmlFor="utm_medium">UTM medium</Label>
                <Input
                  id="utm_medium"
                  value={utmMedium}
                  onChange={(e) => setUtmMedium(e.target.value)}
                  placeholder="tiktok, instagram, blog"
                />
              </div>
              <div>
                <Label htmlFor="utm_campaign">UTM campaign</Label>
                <Input
                  id="utm_campaign"
                  value={utmCampaign}
                  onChange={(e) => setUtmCampaign(e.target.value)}
                  placeholder="spring-launch"
                />
              </div>
            </div>
            <div>
              <Button onClick={handleGenerate} disabled={loading}>
                Create link
              </Button>
            </div>
          </div>

          <div className="border border-ui-border-base rounded-md p-4">
            <Heading level="h2" className="mb-3">
              My links
            </Heading>
            {links.length === 0 ? (
              <Text className="text-ui-fg-subtle italic">
                No links yet. Generate one above to get started.
              </Text>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ui-fg-subtle border-b">
                    <th className="py-2">Code</th>
                    <th className="py-2">Destination</th>
                    <th className="py-2">UTM</th>
                    <th className="py-2 text-right">Clicks</th>
                    <th className="py-2 text-right">Attributed orders</th>
                    <th className="py-2">Status</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => (
                    <tr key={l.id} className="border-b">
                      <td className="py-2 font-mono">{l.short_code}</td>
                      <td className="py-2">{l.destination_path}</td>
                      <td className="py-2 text-ui-fg-subtle">
                        {[l.utm_medium, l.utm_campaign].filter(Boolean).join(" / ")}
                      </td>
                      <td className="py-2 text-right">{Number(l.click_count)}</td>
                      <td className="py-2 text-right">
                        {Number(l.attributed_order_count)}
                      </td>
                      <td className="py-2">{l.status}</td>
                      <td className="py-2 text-right">
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => copyShare(l)}
                        >
                          Copy share URL
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "programs" && (
        <div className="flex flex-col gap-3">
          {openPrograms.length === 0 ? (
            <Text className="text-ui-fg-subtle italic">
              No open programs available right now. Check back later.
            </Text>
          ) : null}
          {openPrograms.map((p) => {
            const myApp = myApplications.find((a) => a.program_id === p.id)
            return (
              <div
                key={p.id}
                className="border border-ui-border-base rounded-md p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <Heading level="h3">{p.title}</Heading>
                    <Text className="text-xs text-ui-fg-subtle">
                      {p.program_type} ·{" "}
                      {p.commission_percent
                        ? `${p.commission_percent}% commission`
                        : p.sponsorship_flat_cents
                        ? `flat ${formatCents(p.sponsorship_flat_cents)}`
                        : p.pool_total_cents
                        ? `pool ${formatCents(p.pool_total_cents)}`
                        : "—"}{" "}
                      · {p.cookie_window_days}d cookie
                      {p.requires_kyc ? " · KYC required" : ""}
                      {p.min_followers
                        ? ` · ${p.min_followers.toLocaleString()}+ followers`
                        : ""}
                      {p.ends_at ? ` · ends ${formatDate(p.ends_at)}` : ""}
                    </Text>
                  </div>
                </div>
                {myApp ? (
                  <div className="mt-2 flex items-center justify-between">
                    <Text className="text-sm">
                      Application status:{" "}
                      <strong>{myApp.status}</strong>
                      {myApp.decision_reason ? ` — ${myApp.decision_reason}` : ""}
                    </Text>
                    {myApp.status === "pending" ? (
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => void withdrawApplication(p.id)}
                      >
                        Withdraw
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    <Textarea
                      rows={2}
                      placeholder="Why this fits your audience (optional pitch)"
                      value={pitchByProgram[p.id] ?? ""}
                      onChange={(e) =>
                        setPitchByProgram((m) => ({
                          ...m,
                          [p.id]: e.target.value,
                        }))
                      }
                    />
                    <div>
                      <Button
                        size="small"
                        onClick={() => void applyToProgram(p.id)}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === "deals" && (
        <div className="border border-ui-border-base rounded-md p-4">
          <Heading level="h2" className="mb-3">
            My deals
          </Heading>
          {myDeals.length === 0 ? (
            <Text className="text-ui-fg-subtle italic">
              No active deals. Apply to a program to open one.
            </Text>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ui-fg-subtle border-b">
                  <th className="py-2">Deal</th>
                  <th className="py-2">Program</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Attributed</th>
                  <th className="py-2 text-right">Paid out</th>
                  <th className="py-2">Default link</th>
                  <th className="py-2">Until</th>
                </tr>
              </thead>
              <tbody>
                {myDeals.map((d) => (
                  <tr key={d.id} className="border-b">
                    <td className="py-2 font-mono text-xs">{d.id}</td>
                    <td className="py-2 font-mono text-xs">{d.program_id}</td>
                    <td className="py-2">{d.status}</td>
                    <td className="py-2 text-right">
                      {formatCents(Number(d.total_attributed_cents))}
                    </td>
                    <td className="py-2 text-right">
                      {formatCents(Number(d.total_paid_out_cents))}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {d.default_affiliate_link_id ?? "—"}
                    </td>
                    <td className="py-2">
                      {d.effective_until ? formatDate(d.effective_until) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "posts" && (
        <div className="flex flex-col gap-4">
          <div className="border border-ui-border-base rounded-md p-4 flex flex-col gap-3">
            <Heading level="h2">Register a post</Heading>
            <Text className="text-ui-fg-subtle text-xs">
              Paste the URL of a video, photo, blog post, or podcast episode
              you've published. If you've connected the matching platform
              account, ownership is auto-verified.
            </Text>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="post-platform">Platform</Label>
                <select
                  id="post-platform"
                  className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base w-full"
                  value={postPlatform}
                  onChange={(e) => setPostPlatform(e.target.value)}
                >
                  {availablePlatforms.length === 0 ? (
                    <option value="custom">custom</option>
                  ) : (
                    availablePlatforms.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <Label htmlFor="post-id">External post id</Label>
                <Input
                  id="post-id"
                  value={postExternalId}
                  onChange={(e) => setPostExternalId(e.target.value)}
                  placeholder="video_12345"
                />
              </div>
              <div>
                <Label htmlFor="post-url">Public URL</Label>
                <Input
                  id="post-url"
                  value={postExternalUrl}
                  onChange={(e) => setPostExternalUrl(e.target.value)}
                  placeholder="https://www.tiktok.com/@me/video/123"
                />
              </div>
              <div>
                <Label htmlFor="post-link">Affiliate link id (optional)</Label>
                <Input
                  id="post-link"
                  value={postAffiliateLinkId}
                  onChange={(e) => setPostAffiliateLinkId(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="post-deal">Deal id (optional)</Label>
                <Input
                  id="post-deal"
                  value={postDealId}
                  onChange={(e) => setPostDealId(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Button onClick={registerPost} disabled={loading}>
                Register post
              </Button>
            </div>
          </div>

          <div className="border border-ui-border-base rounded-md p-4">
            <Heading level="h2" className="mb-3">
              My posts
            </Heading>
            {posts.length === 0 ? (
              <Text className="text-ui-fg-subtle italic">
                No posts registered yet.
              </Text>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ui-fg-subtle border-b">
                    <th className="py-2">Platform</th>
                    <th className="py-2">URL</th>
                    <th className="py-2">Verification</th>
                    <th className="py-2">Qualified</th>
                    <th className="py-2">Verified at</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((p) => (
                    <tr key={p.id} className="border-b">
                      <td className="py-2">{p.platform}</td>
                      <td className="py-2">
                        <a
                          href={p.external_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline truncate block max-w-xs"
                        >
                          {p.external_url}
                        </a>
                      </td>
                      <td className="py-2">{p.verification_status}</td>
                      <td className="py-2">{p.qualified ? "Yes" : "No"}</td>
                      <td className="py-2">{formatDate(p.verified_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "platforms" && (
        <div className="flex flex-col gap-4">
          <div className="border border-ui-border-base rounded-md p-4 flex flex-col gap-3">
            <Heading level="h2">Connect a platform</Heading>
            <Text className="text-ui-fg-subtle text-xs">
              For TikTok / Instagram / YouTube / Twitch / Blackout, click
              the OAuth button below. For RSS blogs and custom webhook
              integrations, fill in the form.
            </Text>
            <div className="flex flex-wrap gap-2">
              {availablePlatforms
                .filter((p) =>
                  ["tiktok", "instagram", "youtube", "twitch", "blackout"].includes(p)
                )
                .map((p) => (
                  <Button
                    key={p}
                    size="small"
                    variant="secondary"
                    onClick={() => void beginOAuth(p)}
                  >
                    Connect {p}
                  </Button>
                ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
              <div>
                <Label htmlFor="conn-platform">Non-OAuth platform</Label>
                <select
                  id="conn-platform"
                  className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base w-full"
                  value={connectPlatform}
                  onChange={(e) => setConnectPlatform(e.target.value)}
                >
                  <option value="rss">rss</option>
                  <option value="custom">custom (webhook)</option>
                  <option value="podcast">podcast</option>
                </select>
              </div>
              <div>
                <Label htmlFor="conn-id">Account id</Label>
                <Input
                  id="conn-id"
                  value={connectExternalId}
                  onChange={(e) => setConnectExternalId(e.target.value)}
                  placeholder="my-blog or username"
                />
              </div>
              <div>
                <Label htmlFor="conn-handle">Handle (optional)</Label>
                <Input
                  id="conn-handle"
                  value={connectHandle}
                  onChange={(e) => setConnectHandle(e.target.value)}
                />
              </div>
              {connectPlatform === "rss" && (
                <div>
                  <Label htmlFor="conn-feed">RSS feed URL</Label>
                  <Input
                    id="conn-feed"
                    value={connectFeedUrl}
                    onChange={(e) => setConnectFeedUrl(e.target.value)}
                    placeholder="https://blog.example.com/feed.xml"
                  />
                </div>
              )}
            </div>
            <div>
              <Button onClick={connectAccount} disabled={loading}>
                Connect
              </Button>
            </div>
          </div>

          <div className="border border-ui-border-base rounded-md p-4">
            <Heading level="h2" className="mb-3">
              Connected platforms
            </Heading>
            {platformAccounts.length === 0 ? (
              <Text className="text-ui-fg-subtle italic">
                No platforms connected yet.
              </Text>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ui-fg-subtle border-b">
                    <th className="py-2">Platform</th>
                    <th className="py-2">Account</th>
                    <th className="py-2">Handle</th>
                    <th className="py-2 text-right">Followers</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Webhook secret</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {platformAccounts.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="py-2">{a.platform}</td>
                      <td className="py-2 font-mono text-xs">
                        {a.external_account_id}
                      </td>
                      <td className="py-2">{a.handle ?? "—"}</td>
                      <td className="py-2 text-right">
                        {Number(a.follower_count).toLocaleString()}
                      </td>
                      <td className="py-2">{a.status}</td>
                      <td className="py-2 font-mono text-xs">
                        {a.inbound_webhook_secret ? (
                          <span className="text-ui-fg-subtle">
                            {a.inbound_webhook_secret.slice(0, 12)}…
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          size="small"
                          variant="danger"
                          onClick={() => void revokeAccount(a.id)}
                        >
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "earnings" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <KpiCard label="Pending" value={formatCents(rollup?.pending_cents ?? 0)} />
            <KpiCard label="Held" value={formatCents(rollup?.held_cents ?? 0)} />
            <KpiCard label="Approved" value={formatCents(rollup?.approved_cents ?? 0)} />
            <KpiCard label="Paid" value={formatCents(rollup?.paid_cents ?? 0)} />
            <KpiCard label="Reversed" value={formatCents(rollup?.reversed_cents ?? 0)} />
            <KpiCard
              label="Disqualified"
              value={formatCents(rollup?.disqualified_cents ?? 0)}
            />
          </div>

          <div className="border border-ui-border-base rounded-md p-4">
            <Heading level="h2" className="mb-3">
              Recent attributions
            </Heading>
            {attributions.length === 0 ? (
              <Text className="text-ui-fg-subtle italic">
                No attributed orders yet.
              </Text>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ui-fg-subtle border-b">
                    <th className="py-2">Order</th>
                    <th className="py-2">Source</th>
                    <th className="py-2 text-right">Commission</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Decided</th>
                    <th className="py-2">Hold until</th>
                  </tr>
                </thead>
                <tbody>
                  {attributions.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="py-2 font-mono">{a.order_id}</td>
                      <td className="py-2">{a.source}</td>
                      <td className="py-2 text-right">
                        {formatCents(Number(a.commission_amount_cents))}
                      </td>
                      <td className="py-2">{a.commission_status}</td>
                      <td className="py-2">
                        {formatDate(a.attribution_decided_at)}
                      </td>
                      <td className="py-2">
                        {a.hold_until ? formatDate(a.hold_until) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </Container>
  )
}

const KpiCard = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-ui-border-base rounded-md p-4">
    <Text className="text-ui-fg-subtle text-xs uppercase">{label}</Text>
    <div className="text-2xl font-medium mt-1">{value}</div>
  </div>
)
