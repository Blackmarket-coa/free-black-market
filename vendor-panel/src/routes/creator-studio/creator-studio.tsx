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
  const [tab, setTab] = useState<"dashboard" | "links" | "earnings">("dashboard")
  const [links, setLinks] = useState<AffiliateLink[]>([])
  const [rollup, setRollup] = useState<Rollup | null>(null)
  const [attributions, setAttributions] = useState<Attribution[]>([])
  const [loading, setLoading] = useState(false)

  // Generate-link form
  const [productId, setProductId] = useState("")
  const [utmMedium, setUtmMedium] = useState("")
  const [utmCampaign, setUtmCampaign] = useState("")

  const reload = async () => {
    setLoading(true)
    try {
      const [{ links: l }, { rollup: r, attributions: a }] = await Promise.all([
        authedFetch<{ links: AffiliateLink[] }>("/v1/seller/creator/links?limit=50"),
        authedFetch<{ rollup: Rollup; attributions: Attribution[] }>(
          "/v1/seller/creator/earnings?limit=20"
        ),
      ])
      setLinks(l)
      setRollup(r)
      setAttributions(a)
    } catch (err) {
      toast.error("Failed to load creator studio data", {
        description: (err as Error).message,
      })
    } finally {
      setLoading(false)
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
      <div className="flex items-center justify-between">
        <Heading level="h1">Creator Studio</Heading>
        <div className="flex gap-2">
          <Button
            variant={tab === "dashboard" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("dashboard")}
          >
            Dashboard
          </Button>
          <Button
            variant={tab === "links" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("links")}
          >
            Links
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
