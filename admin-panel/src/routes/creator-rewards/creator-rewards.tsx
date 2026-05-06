import { useEffect, useState } from "react"
import { Button, Container, Heading, Label, Text, toast } from "@medusajs/ui"
import { backendUrl } from "@lib/client/client"

interface Pool {
  id: string
  program_id: string | null
  funder_seller_id: string | null
  kind: string
  status: string
  period_start: string
  period_end: string
  total_cents: number
  rate_per_kqv_cents: number | null
  currency_code: string
  distributed_at: string | null
}

interface DistributionPreview {
  pool_id: string
  total_qv: number
  total_distributed_cents: number
  per_creator: Array<{
    creator_seller_id: string
    qualified_views: number
    amount_cents: number
  }>
  ineligible_below_threshold: number
}

const formatCents = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
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

export const CreatorRewardsPage = () => {
  const [pools, setPools] = useState<Pool[]>([])
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [previewById, setPreviewById] = useState<Record<string, DistributionPreview>>({})

  const reload = async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ limit: "100" })
      if (statusFilter) qs.set("status", statusFilter)
      const { pools } = await adminFetch<{ pools: Pool[] }>(
        `/v1/admin/marketplace/reward-pools?${qs.toString()}`
      )
      setPools(pools)
    } catch (err) {
      toast.error("Failed to load pools", {
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

  const previewDistribution = async (id: string) => {
    try {
      const result = await adminFetch<DistributionPreview & { dry_run: boolean }>(
        `/v1/admin/marketplace/reward-pools/${id}/distribute?dry_run=1`,
        { method: "POST" }
      )
      setPreviewById((m) => ({ ...m, [id]: result }))
      toast.success(
        `Preview: ${formatCents(result.total_distributed_cents)} across ${result.per_creator.length} creators`
      )
    } catch (err) {
      toast.error("Preview failed", { description: (err as Error).message })
    }
  }

  const distribute = async (id: string) => {
    if (
      !window.confirm(
        "Commit distribution? This writes ledger entries and credits creator earnings."
      )
    ) {
      return
    }
    try {
      const result = await adminFetch<{
        distributed_count: number
        total_distributed_cents: number
      }>(`/v1/admin/marketplace/reward-pools/${id}/distribute`, {
        method: "POST",
      })
      toast.success(
        `Distributed ${formatCents(result.total_distributed_cents)} to ${result.distributed_count} creators`
      )
      setPreviewById((m) => {
        const next = { ...m }
        delete next[id]
        return next
      })
      await reload()
    } catch (err) {
      toast.error("Distribute failed", { description: (err as Error).message })
    }
  }

  return (
    <Container className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Heading level="h1">Creator Rewards — Pools</Heading>
        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="scheduled">scheduled</option>
              <option value="accruing">accruing</option>
              <option value="calculating">calculating</option>
              <option value="distributed">distributed</option>
              <option value="reverted">reverted</option>
            </select>
          </div>
          <Button size="small" onClick={() => void reload()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="border border-ui-border-base rounded-md p-4">
        {pools.length === 0 ? (
          <Text className="text-ui-fg-subtle italic">No reward pools.</Text>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ui-fg-subtle border-b">
                <th className="py-2">Pool</th>
                <th className="py-2">Program</th>
                <th className="py-2">Funder</th>
                <th className="py-2">Kind</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Total</th>
                <th className="py-2">Period</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {pools.map((p) => (
                <tr key={p.id} className="border-b align-top">
                  <td className="py-2 font-mono text-xs">{p.id}</td>
                  <td className="py-2 font-mono text-xs">{p.program_id ?? "—"}</td>
                  <td className="py-2 font-mono text-xs">
                    {p.funder_seller_id ?? "platform"}
                  </td>
                  <td className="py-2">{p.kind}</td>
                  <td className="py-2">{p.status}</td>
                  <td className="py-2 text-right">
                    {formatCents(p.total_cents, p.currency_code.toUpperCase())}
                  </td>
                  <td className="py-2 text-xs">
                    {formatDate(p.period_start)} – {formatDate(p.period_end)}
                  </td>
                  <td className="py-2">
                    {p.status === "distributed" || p.status === "reverted" ? (
                      <Text className="text-ui-fg-subtle italic">
                        {formatDate(p.distributed_at)}
                      </Text>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => void previewDistribution(p.id)}
                        >
                          Preview
                        </Button>
                        <Button
                          size="small"
                          onClick={() => void distribute(p.id)}
                        >
                          Distribute
                        </Button>
                      </div>
                    )}
                    {previewById[p.id] ? (
                      <div className="mt-2 text-xs text-ui-fg-subtle">
                        {previewById[p.id].per_creator.length} creators ·
                        {" "}
                        {formatCents(
                          previewById[p.id].total_distributed_cents,
                          p.currency_code.toUpperCase()
                        )}
                        {previewById[p.id].ineligible_below_threshold > 0
                          ? ` · ${previewById[p.id].ineligible_below_threshold} below threshold`
                          : ""}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Container>
  )
}
