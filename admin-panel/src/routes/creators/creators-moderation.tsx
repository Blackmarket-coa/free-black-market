import { useEffect, useState } from "react"
import {
  Button,
  Container,
  Heading,
  Label,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { backendUrl } from "@lib/client/client"

interface CreatorRow {
  seller_id: string
  handle: string | null
  bio: string | null
  niches: string[]
  total_followers: number
  verified: boolean
  featured: boolean
  rating: number | null
  review_count: number
  created_at: string
}

interface AttributionRow {
  id: string
  order_id: string
  creator_seller_id: string
  vendor_id: string | null
  source: string
  commission_amount_cents: number
  commission_status: string
  attribution_decided_at: string
  hold_until: string | null
  disqualified_reason: string | null
}

const formatCents = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(cents) / 100
  )

const formatDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${backendUrl.replace(/\/$/, "")}${path}`
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`${res.status}: ${body || res.statusText}`)
  }
  return (await res.json()) as T
}

export const CreatorsModerationPage = () => {
  const [tab, setTab] = useState<"creators" | "attributions">("creators")
  const [creators, setCreators] = useState<CreatorRow[]>([])
  const [attributions, setAttributions] = useState<AttributionRow[]>([])
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [reasonByAttribution, setReasonByAttribution] = useState<
    Record<string, string>
  >({})

  const reload = async () => {
    setLoading(true)
    try {
      const cQs = new URLSearchParams({ limit: "100" })
      const aQs = new URLSearchParams({ limit: "100" })
      if (statusFilter) aQs.set("status", statusFilter)
      const [cRes, aRes] = await Promise.all([
        adminFetch<{ creators: CreatorRow[] }>(
          `/v1/admin/marketplace/creators?${cQs.toString()}`
        ),
        adminFetch<{ attributions: AttributionRow[] }>(
          `/v1/admin/marketplace/attributions?${aQs.toString()}`
        ),
      ])
      setCreators(cRes.creators)
      setAttributions(aRes.attributions)
    } catch (err) {
      toast.error("Failed to load creator moderation data", {
        description: (err as Error).message,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const handleDisqualify = async (id: string) => {
    const reason = (reasonByAttribution[id] || "").trim()
    if (reason.length < 2) {
      toast.error("Please provide a reason before disqualifying")
      return
    }
    try {
      await adminFetch(`/v1/admin/marketplace/attributions/${id}/disqualify`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      })
      toast.success("Attribution disqualified")
      setReasonByAttribution((m) => {
        const next = { ...m }
        delete next[id]
        return next
      })
      await reload()
    } catch (err) {
      toast.error("Disqualify failed", { description: (err as Error).message })
    }
  }

  return (
    <Container className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Heading level="h1">Creator Program — Moderation</Heading>
        <div className="flex gap-2">
          <Button
            variant={tab === "creators" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("creators")}
          >
            Creators ({creators.length})
          </Button>
          <Button
            variant={tab === "attributions" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("attributions")}
          >
            Attributions ({attributions.length})
          </Button>
        </div>
      </div>

      {tab === "creators" && (
        <div className="border border-ui-border-base rounded-md p-4">
          <Heading level="h2" className="mb-3">
            Registered creators
          </Heading>
          {creators.length === 0 ? (
            <Text className="text-ui-fg-subtle italic">No creators yet.</Text>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ui-fg-subtle border-b">
                  <th className="py-2">Handle</th>
                  <th className="py-2">Seller ID</th>
                  <th className="py-2">Niches</th>
                  <th className="py-2 text-right">Followers</th>
                  <th className="py-2">Verified</th>
                  <th className="py-2">Featured</th>
                  <th className="py-2">Joined</th>
                </tr>
              </thead>
              <tbody>
                {creators.map((c) => (
                  <tr key={c.seller_id} className="border-b">
                    <td className="py-2 font-mono">@{c.handle ?? "—"}</td>
                    <td className="py-2 font-mono text-xs">{c.seller_id}</td>
                    <td className="py-2 text-ui-fg-subtle">
                      {(c.niches || []).join(", ")}
                    </td>
                    <td className="py-2 text-right">
                      {Number(c.total_followers).toLocaleString()}
                    </td>
                    <td className="py-2">{c.verified ? "Yes" : "No"}</td>
                    <td className="py-2">{c.featured ? "Yes" : "No"}</td>
                    <td className="py-2">{formatDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "attributions" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <div>
              <Label htmlFor="status">Filter by status</Label>
              <select
                id="status"
                className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="pending">pending</option>
                <option value="held">held</option>
                <option value="approved">approved</option>
                <option value="paid">paid</option>
                <option value="reversed">reversed</option>
                <option value="disqualified">disqualified</option>
              </select>
            </div>
            <Button size="small" onClick={() => void reload()} disabled={loading}>
              Refresh
            </Button>
          </div>

          <div className="border border-ui-border-base rounded-md p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ui-fg-subtle border-b">
                  <th className="py-2">Order</th>
                  <th className="py-2">Creator</th>
                  <th className="py-2">Source</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Hold until</th>
                  <th className="py-2">Disqualify</th>
                </tr>
              </thead>
              <tbody>
                {attributions.map((a) => (
                  <tr key={a.id} className="border-b align-top">
                    <td className="py-2 font-mono text-xs">{a.order_id}</td>
                    <td className="py-2 font-mono text-xs">{a.creator_seller_id}</td>
                    <td className="py-2">{a.source}</td>
                    <td className="py-2 text-right">
                      {formatCents(a.commission_amount_cents)}
                    </td>
                    <td className="py-2">{a.commission_status}</td>
                    <td className="py-2">{formatDate(a.hold_until)}</td>
                    <td className="py-2">
                      {a.commission_status === "approved" ||
                      a.commission_status === "paid" ||
                      a.commission_status === "reversed" ||
                      a.commission_status === "disqualified" ? (
                        <Text className="text-ui-fg-subtle italic">
                          {a.disqualified_reason || "—"}
                        </Text>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <Textarea
                            placeholder="Reason"
                            rows={2}
                            value={reasonByAttribution[a.id] ?? ""}
                            onChange={(e) =>
                              setReasonByAttribution((m) => ({
                                ...m,
                                [a.id]: e.target.value,
                              }))
                            }
                          />
                          <Button
                            size="small"
                            variant="danger"
                            onClick={() => void handleDisqualify(a.id)}
                          >
                            Disqualify
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {attributions.length === 0 && (
              <Text className="text-ui-fg-subtle italic">
                No attributions for this filter.
              </Text>
            )}
          </div>
        </div>
      )}
    </Container>
  )
}
