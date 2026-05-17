import { useEffect, useState } from "react"
import { Button, Container, Heading, Label, Text, Textarea, toast } from "@medusajs/ui"
import { backendUrl } from "@lib/client/client"

interface ServiceProgramRow {
  id: string
  vendor_id: string
  title: string
  service_category: string
  program_type: string
  status: string
  unit_price_cents: number | null
  currency_code: string
  requires_kyc: boolean
}

interface SubcontractRow {
  id: string
  parent_order_id: string
  parent_seller_id: string
  subcontract_seller_id: string
  status: string
  total_cents: number
  currency_code: string
  dispute_reason: string | null
}

interface ProofRow {
  id: string
  owner_seller_id: string
  context_type: string
  context_id: string
  kind: string
  storage_url: string | null
  verification_status: string
  verification_method: string | null
  verified_at: string | null
}

const formatCents = (cents: number | null | undefined, currency = "USD") =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
        Number(cents) / 100
      )

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

export const ServicesAdminPage = () => {
  const [tab, setTab] = useState<"programs" | "subcontracts" | "proofs">("programs")
  const [programs, setPrograms] = useState<ServiceProgramRow[]>([])
  const [subcontracts, setSubcontracts] = useState<SubcontractRow[]>([])
  const [proofs, setProofs] = useState<ProofRow[]>([])
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [proofStatusFilter, setProofStatusFilter] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [resolveAmountById, setResolveAmountById] = useState<Record<string, string>>({})
  const [rejectReasonById, setRejectReasonById] = useState<Record<string, string>>({})

  const reload = async () => {
    setLoading(true)
    try {
      const subQs = new URLSearchParams({ limit: "100" })
      if (statusFilter) subQs.set("status", statusFilter)
      const proofQs = new URLSearchParams({ limit: "100" })
      if (proofStatusFilter) proofQs.set("verification_status", proofStatusFilter)
      const [{ programs }, { subcontracts: subs }, { proofs: ps }] = await Promise.all([
        adminFetch<{ programs: ServiceProgramRow[] }>(
          `/v1/admin/marketplace/service-programs?limit=100`
        ),
        adminFetch<{ subcontracts: SubcontractRow[] }>(
          `/v1/admin/marketplace/subcontracts?${subQs.toString()}`
        ),
        adminFetch<{ proofs: ProofRow[] }>(
          `/v1/admin/marketplace/proofs?${proofQs.toString()}`
        ),
      ])
      setPrograms(programs)
      setSubcontracts(subs)
      setProofs(ps)
    } catch (err) {
      toast.error("Failed to load services data", {
        description: (err as Error).message,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, proofStatusFilter])

  const resolveSubcontract = async (
    id: string,
    decision: "release" | "refund" | "split"
  ) => {
    const reason = window.prompt(`Reason for ${decision}:`)
    if (!reason || reason.trim().length < 2) return
    const body: Record<string, unknown> = { decision, reason }
    if (decision === "split") {
      const amt = parseInt(resolveAmountById[id] || "0", 10)
      body.release_amount_cents = Number.isFinite(amt) ? amt : 0
    }
    try {
      await adminFetch(`/v1/admin/marketplace/subcontracts/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify(body),
      })
      toast.success(`Subcontract ${decision}d`)
      await reload()
    } catch (err) {
      toast.error("Resolve failed", { description: (err as Error).message })
    }
  }

  const verifyProof = async (id: string) => {
    try {
      await adminFetch(`/v1/admin/marketplace/proofs/${id}/verify`, {
        method: "POST",
      })
      toast.success("Proof manually verified")
      await reload()
    } catch (err) {
      toast.error("Verify failed", { description: (err as Error).message })
    }
  }

  const rejectProof = async (id: string) => {
    const reason = (rejectReasonById[id] || "").trim()
    if (reason.length < 2) {
      toast.error("Please provide a reason")
      
return
    }
    try {
      await adminFetch(`/v1/admin/marketplace/proofs/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      })
      toast.success("Proof rejected")
      setRejectReasonById((m) => {
        const next = { ...m }
        delete next[id]
        
return next
      })
      await reload()
    } catch (err) {
      toast.error("Reject failed", { description: (err as Error).message })
    }
  }

  return (
    <Container className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Heading level="h1">Services — Admin Oversight</Heading>
        <div className="flex gap-2">
          <Button
            variant={tab === "programs" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("programs")}
          >
            Programs ({programs.length})
          </Button>
          <Button
            variant={tab === "subcontracts" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("subcontracts")}
          >
            Subcontracts ({subcontracts.length})
          </Button>
          <Button
            variant={tab === "proofs" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("proofs")}
          >
            Proofs ({proofs.length})
          </Button>
        </div>
      </div>

      {tab === "programs" && (
        <div className="border border-ui-border-base rounded-md p-4">
          {programs.length === 0 ? (
            <Text className="text-ui-fg-subtle italic">No service programs.</Text>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ui-fg-subtle border-b">
                  <th className="py-2">Title</th>
                  <th className="py-2">Vendor</th>
                  <th className="py-2">Category</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Unit price</th>
                  <th className="py-2">KYC</th>
                </tr>
              </thead>
              <tbody>
                {programs.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2">{p.title}</td>
                    <td className="py-2 font-mono text-xs">{p.vendor_id}</td>
                    <td className="py-2">{p.service_category}</td>
                    <td className="py-2">{p.program_type}</td>
                    <td className="py-2">{p.status}</td>
                    <td className="py-2 text-right">
                      {formatCents(p.unit_price_cents, p.currency_code.toUpperCase())}
                    </td>
                    <td className="py-2">{p.requires_kyc ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "subcontracts" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <div>
              <Label htmlFor="sc-status">Status</Label>
              <select
                id="sc-status"
                className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="proposed">proposed</option>
                <option value="accepted">accepted</option>
                <option value="in_progress">in_progress</option>
                <option value="delivered">delivered</option>
                <option value="accepted_by_parent">accepted_by_parent</option>
                <option value="disputed">disputed</option>
                <option value="canceled">canceled</option>
              </select>
            </div>
            <Button size="small" onClick={() => void reload()} disabled={loading}>
              Refresh
            </Button>
          </div>
          <div className="border border-ui-border-base rounded-md p-4">
            {subcontracts.length === 0 ? (
              <Text className="text-ui-fg-subtle italic">No subcontracts.</Text>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ui-fg-subtle border-b">
                    <th className="py-2">Subcontract</th>
                    <th className="py-2">Parent / provider</th>
                    <th className="py-2">Status</th>
                    <th className="py-2 text-right">Total</th>
                    <th className="py-2">Resolve</th>
                  </tr>
                </thead>
                <tbody>
                  {subcontracts.map((s) => (
                    <tr key={s.id} className="border-b align-top">
                      <td className="py-2 font-mono text-xs">{s.id}</td>
                      <td className="py-2 font-mono text-xs">
                        {s.parent_seller_id} → {s.subcontract_seller_id}
                      </td>
                      <td className="py-2">
                        {s.status}
                        {s.dispute_reason ? (
                          <div className="text-xs text-ui-fg-subtle italic mt-1">
                            {s.dispute_reason}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 text-right">
                        {formatCents(s.total_cents, s.currency_code.toUpperCase())}
                      </td>
                      <td className="py-2">
                        {s.status === "disputed" ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex gap-1">
                              <Button
                                size="small"
                                onClick={() => void resolveSubcontract(s.id, "release")}
                              >
                                Release to provider
                              </Button>
                              <Button
                                size="small"
                                variant="secondary"
                                onClick={() => void resolveSubcontract(s.id, "refund")}
                              >
                                Refund parent
                              </Button>
                            </div>
                            <div className="flex gap-1 items-center">
                              <input
                                type="number"
                                min="0"
                                placeholder="release cents"
                                className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base text-xs w-32"
                                value={resolveAmountById[s.id] ?? ""}
                                onChange={(e) =>
                                  setResolveAmountById((m) => ({
                                    ...m,
                                    [s.id]: e.target.value,
                                  }))
                                }
                              />
                              <Button
                                size="small"
                                variant="secondary"
                                onClick={() => void resolveSubcontract(s.id, "split")}
                              >
                                Split
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Text className="text-ui-fg-subtle italic">—</Text>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "proofs" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <div>
              <Label htmlFor="proof-status">Status</Label>
              <select
                id="proof-status"
                className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base"
                value={proofStatusFilter}
                onChange={(e) => setProofStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="unverified">unverified</option>
                <option value="auto_verified">auto_verified</option>
                <option value="manually_verified">manually_verified</option>
                <option value="disputed">disputed</option>
                <option value="rejected">rejected</option>
              </select>
            </div>
            <Button size="small" onClick={() => void reload()} disabled={loading}>
              Refresh
            </Button>
          </div>
          <div className="border border-ui-border-base rounded-md p-4">
            {proofs.length === 0 ? (
              <Text className="text-ui-fg-subtle italic">No proofs.</Text>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ui-fg-subtle border-b">
                    <th className="py-2">Proof</th>
                    <th className="py-2">Owner</th>
                    <th className="py-2">Context</th>
                    <th className="py-2">Kind</th>
                    <th className="py-2">URL</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {proofs.map((p) => (
                    <tr key={p.id} className="border-b align-top">
                      <td className="py-2 font-mono text-xs">{p.id}</td>
                      <td className="py-2 font-mono text-xs">{p.owner_seller_id}</td>
                      <td className="py-2 text-xs">
                        {p.context_type}
                        <br />
                        <span className="font-mono">{p.context_id}</span>
                      </td>
                      <td className="py-2">{p.kind}</td>
                      <td className="py-2">
                        {p.storage_url ? (
                          <a
                            href={p.storage_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline truncate block max-w-xs"
                          >
                            view
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2">
                        {p.verification_status}
                        {p.verification_method ? (
                          <div className="text-xs text-ui-fg-subtle">
                            {p.verification_method}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2">
                        {p.verification_status !== "manually_verified" &&
                        p.verification_status !== "rejected" ? (
                          <div className="flex flex-col gap-1">
                            <Button
                              size="small"
                              onClick={() => void verifyProof(p.id)}
                            >
                              Verify
                            </Button>
                            <Textarea
                              rows={2}
                              placeholder="Reject reason"
                              value={rejectReasonById[p.id] ?? ""}
                              onChange={(e) =>
                                setRejectReasonById((m) => ({
                                  ...m,
                                  [p.id]: e.target.value,
                                }))
                              }
                            />
                            <Button
                              size="small"
                              variant="danger"
                              onClick={() => void rejectProof(p.id)}
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <Text className="text-ui-fg-subtle italic">—</Text>
                        )}
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
