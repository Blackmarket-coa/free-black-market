import { useEffect, useState } from "react"
import { Button, Container, Heading, Label, Text, toast } from "@medusajs/ui"
import { sdk } from "@lib/client"

interface Program {
  id: string
  vendor_id: string
  title: string
  slug: string
  program_type: string
  status: string
  commission_percent: number | null
  budget_cap_cents: number | null
  budget_spent_cents: number
  currency_code: string
  requires_kyc: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

const formatCents = (cents: number | null | undefined, currency = "USD") =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
        Number(cents) / 100
      )

const formatDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"

export const CreatorProgramsAdminPage = () => {
  const [programs, setPrograms] = useState<Program[]>([])
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [loading, setLoading] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const { programs } = await sdk.client.fetch<{ programs: Program[] }>(
        "/v1/admin/marketplace/programs",
        { query: { limit: 100, status: statusFilter || undefined } }
      )
      setPrograms(programs)
    } catch (err) {
      toast.error("Failed to load programs", {
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

  const forceClose = async (id: string) => {
    const reason = window.prompt("Reason for force-closing:")
    if (!reason || reason.trim().length < 2) return
    try {
      await sdk.client.fetch(
        `/v1/admin/marketplace/programs/${id}/force-close`,
        { method: "POST", body: { reason } }
      )
      toast.success("Program force-closed")
      await reload()
    } catch (err) {
      toast.error("Force-close failed", {
        description: (err as Error).message,
      })
    }
  }

  return (
    <Container className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Heading level="h1">Creator Programs — Admin Oversight</Heading>
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
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="closed">closed</option>
              <option value="archived">archived</option>
            </select>
          </div>
          <Button size="small" onClick={() => void reload()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="border border-ui-border-base rounded-md p-4">
        {programs.length === 0 ? (
          <Text className="text-ui-fg-subtle italic">No programs.</Text>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ui-fg-subtle border-b">
                <th className="py-2">Title</th>
                <th className="py-2">Vendor</th>
                <th className="py-2">Type</th>
                <th className="py-2">Status</th>
                <th className="py-2">KYC</th>
                <th className="py-2 text-right">Budget cap</th>
                <th className="py-2 text-right">Spent</th>
                <th className="py-2">Ends</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {programs.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-2">
                    <div className="font-medium">{p.title}</div>
                    <div className="text-xs text-ui-fg-subtle font-mono">
                      {p.slug}
                    </div>
                  </td>
                  <td className="py-2 font-mono text-xs">{p.vendor_id}</td>
                  <td className="py-2">{p.program_type}</td>
                  <td className="py-2">{p.status}</td>
                  <td className="py-2">{p.requires_kyc ? "Yes" : "No"}</td>
                  <td className="py-2 text-right">
                    {formatCents(p.budget_cap_cents, p.currency_code.toUpperCase())}
                  </td>
                  <td className="py-2 text-right">
                    {formatCents(p.budget_spent_cents, p.currency_code.toUpperCase())}
                  </td>
                  <td className="py-2">{formatDate(p.ends_at)}</td>
                  <td className="py-2 text-right">
                    {p.status !== "closed" && p.status !== "archived" ? (
                      <Button
                        size="small"
                        variant="danger"
                        onClick={() => void forceClose(p.id)}
                      >
                        Force-close
                      </Button>
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
