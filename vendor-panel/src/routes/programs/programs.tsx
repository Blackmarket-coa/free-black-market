import { useEffect, useMemo, useState } from "react"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { backendUrl, getAuthToken } from "../../lib/client"

type ProgramType =
  | "affiliate_open"
  | "affiliate_invite"
  | "sponsored_brief"
  | "commission_boost"
  | "engagement_pool"

interface Program {
  id: string
  vendor_id: string
  title: string
  slug: string
  description: string | null
  brief_markdown: string | null
  program_type: ProgramType
  status: string
  commission_percent: number | null
  commission_flat_cents: number | null
  sponsorship_flat_cents: number | null
  pool_total_cents: number | null
  pool_period: string | null
  cookie_window_days: number
  hold_days: number
  currency_code: string
  starts_at: string | null
  ends_at: string | null
  budget_cap_cents: number | null
  budget_spent_cents: number
  requires_kyc: boolean
  min_verification_level: string | null
  product_ids: string[] | null
  min_followers: number | null
  created_at: string
}

interface Application {
  id: string
  program_id: string
  creator_seller_id: string
  pitch: string | null
  proposed_platforms: string[] | null
  follower_snapshot: Record<string, number> | null
  status: string
  decided_at: string | null
  decision_reason: string | null
  created_at: string
}

interface Deal {
  id: string
  program_id: string
  application_id: string
  creator_seller_id: string
  status: string
  effective_from: string
  effective_until: string | null
  total_attributed_cents: number
  total_paid_out_cents: number
  default_affiliate_link_id: string | null
  violation_reason: string | null
}

const formatCents = (cents: number | null | undefined, currency = "USD") =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
        Number(cents) / 100
      )

const formatDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"

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

export const ProgramsPage = () => {
  const [programs, setPrograms] = useState<Program[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [applications, setApplications] = useState<Application[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [reasonByApp, setReasonByApp] = useState<Record<string, string>>({})

  const reload = async () => {
    try {
      const { programs } = await authedFetch<{ programs: Program[] }>(
        "/v1/seller/programs"
      )
      setPrograms(programs)
      if (selectedId === null && programs.length > 0) {
        setSelectedId(programs[0].id)
      }
    } catch (err) {
      toast.error("Failed to load programs", {
        description: (err as Error).message,
      })
    }
  }

  const loadDetails = async (programId: string) => {
    try {
      const [{ applications: a }, { deals: d }] = await Promise.all([
        authedFetch<{ applications: Application[] }>(
          `/v1/seller/programs/${programId}/applications`
        ),
        authedFetch<{ deals: Deal[] }>(`/v1/seller/programs/${programId}/deals`),
      ])
      setApplications(a)
      setDeals(d)
    } catch (err) {
      toast.error("Failed to load program details", {
        description: (err as Error).message,
      })
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedId) void loadDetails(selectedId)
  }, [selectedId])

  const selectedProgram = useMemo(
    () => programs.find((p) => p.id === selectedId) ?? null,
    [programs, selectedId]
  )

  const decide = async (
    programId: string,
    appId: string,
    decision: "approve" | "reject"
  ) => {
    const reason = reasonByApp[appId]?.trim() || null
    try {
      await authedFetch(
        `/v1/seller/programs/${programId}/applications/${appId}/decide`,
        {
          method: "POST",
          body: JSON.stringify({ decision, reason }),
        }
      )
      toast.success(
        decision === "approve"
          ? "Application approved — deal opened with default link"
          : "Application rejected"
      )
      setReasonByApp((m) => {
        const next = { ...m }
        delete next[appId]
        return next
      })
      await loadDetails(programId)
    } catch (err) {
      toast.error("Decision failed", { description: (err as Error).message })
    }
  }

  const violateDeal = async (programId: string, dealId: string) => {
    const reason = window.prompt("Reason for marking this deal violated:")
    if (!reason) return
    try {
      await authedFetch(
        `/v1/seller/programs/${programId}/deals/${dealId}/violate`,
        {
          method: "POST",
          body: JSON.stringify({ reason, pause_links: true }),
        }
      )
      toast.success("Deal marked violated and links paused")
      await loadDetails(programId)
    } catch (err) {
      toast.error("Violate failed", { description: (err as Error).message })
    }
  }

  const publishProgram = async (programId: string) => {
    try {
      await authedFetch(`/v1/seller/programs/${programId}/publish`, {
        method: "POST",
      })
      toast.success("Program published")
      await reload()
    } catch (err) {
      toast.error("Publish failed", { description: (err as Error).message })
    }
  }

  return (
    <Container className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Heading level="h1">Creator Programs</Heading>
        <Button onClick={() => setShowCreate(true)}>+ New program</Button>
      </div>

      {showCreate && (
        <CreateProgramForm
          onCancel={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false)
            await reload()
          }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="border border-ui-border-base rounded-md p-4 lg:col-span-1">
          <Heading level="h2" className="mb-3">
            My programs ({programs.length})
          </Heading>
          {programs.length === 0 ? (
            <Text className="text-ui-fg-subtle italic">
              No programs yet. Create one to start recruiting creators.
            </Text>
          ) : (
            <ul className="flex flex-col gap-2">
              {programs.map((p) => (
                <li key={p.id}>
                  <button
                    className={`w-full text-left p-3 rounded border ${
                      p.id === selectedId
                        ? "border-ui-border-interactive bg-ui-bg-base-hover"
                        : "border-ui-border-base"
                    }`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <div className="font-medium">{p.title}</div>
                    <div className="text-xs text-ui-fg-subtle">
                      {p.program_type} · {p.status}
                    </div>
                    <div className="text-xs text-ui-fg-subtle">
                      {p.commission_percent
                        ? `${p.commission_percent}% commission`
                        : p.sponsorship_flat_cents
                        ? `Flat ${formatCents(p.sponsorship_flat_cents)}`
                        : p.pool_total_cents
                        ? `Pool ${formatCents(p.pool_total_cents)}`
                        : "—"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4">
          {selectedProgram ? (
            <>
              <div className="border border-ui-border-base rounded-md p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Heading level="h2">{selectedProgram.title}</Heading>
                    <Text className="text-ui-fg-subtle">
                      {selectedProgram.program_type} · status:{" "}
                      <strong>{selectedProgram.status}</strong>
                    </Text>
                    {selectedProgram.description ? (
                      <Text className="mt-2">{selectedProgram.description}</Text>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    {selectedProgram.status === "draft" ? (
                      <Button
                        size="small"
                        onClick={() => void publishProgram(selectedProgram.id)}
                      >
                        Publish
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
                  <KV
                    label="Cookie window"
                    value={`${selectedProgram.cookie_window_days}d`}
                  />
                  <KV label="Hold" value={`${selectedProgram.hold_days}d`} />
                  <KV
                    label="KYC gated"
                    value={selectedProgram.requires_kyc ? "Yes" : "No"}
                  />
                  <KV
                    label="Min KYC"
                    value={selectedProgram.min_verification_level ?? "—"}
                  />
                  <KV
                    label="Budget cap"
                    value={formatCents(selectedProgram.budget_cap_cents)}
                  />
                  <KV
                    label="Budget spent"
                    value={formatCents(selectedProgram.budget_spent_cents)}
                  />
                  <KV
                    label="Min followers"
                    value={
                      selectedProgram.min_followers != null
                        ? selectedProgram.min_followers.toLocaleString()
                        : "—"
                    }
                  />
                  <KV label="Ends" value={formatDate(selectedProgram.ends_at)} />
                </div>
              </div>

              <div className="border border-ui-border-base rounded-md p-4">
                <Heading level="h2" className="mb-3">
                  Applications ({applications.length})
                </Heading>
                {applications.length === 0 ? (
                  <Text className="text-ui-fg-subtle italic">
                    No applications yet.
                  </Text>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-ui-fg-subtle border-b">
                        <th className="py-2">Creator</th>
                        <th className="py-2">Pitch</th>
                        <th className="py-2">Status</th>
                        <th className="py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {applications.map((a) => (
                        <tr key={a.id} className="border-b align-top">
                          <td className="py-2 font-mono text-xs">
                            {a.creator_seller_id}
                          </td>
                          <td className="py-2">
                            {a.pitch ? (
                              <span>{a.pitch}</span>
                            ) : (
                              <span className="text-ui-fg-subtle italic">
                                no pitch
                              </span>
                            )}
                          </td>
                          <td className="py-2">{a.status}</td>
                          <td className="py-2">
                            {a.status === "pending" ? (
                              <div className="flex flex-col gap-1">
                                <Textarea
                                  rows={2}
                                  placeholder="Reason (optional for approve, recommended for reject)"
                                  value={reasonByApp[a.id] ?? ""}
                                  onChange={(e) =>
                                    setReasonByApp((m) => ({
                                      ...m,
                                      [a.id]: e.target.value,
                                    }))
                                  }
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="small"
                                    onClick={() =>
                                      void decide(
                                        selectedProgram.id,
                                        a.id,
                                        "approve"
                                      )
                                    }
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    size="small"
                                    variant="danger"
                                    onClick={() =>
                                      void decide(
                                        selectedProgram.id,
                                        a.id,
                                        "reject"
                                      )
                                    }
                                  >
                                    Reject
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Text className="text-ui-fg-subtle italic">
                                {a.decision_reason ?? "—"}
                              </Text>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="border border-ui-border-base rounded-md p-4">
                <Heading level="h2" className="mb-3">
                  Active deals ({deals.length})
                </Heading>
                {deals.length === 0 ? (
                  <Text className="text-ui-fg-subtle italic">
                    No deals yet.
                  </Text>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-ui-fg-subtle border-b">
                        <th className="py-2">Creator</th>
                        <th className="py-2">Status</th>
                        <th className="py-2 text-right">Attributed</th>
                        <th className="py-2 text-right">Paid out</th>
                        <th className="py-2">Default link</th>
                        <th className="py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {deals.map((d) => (
                        <tr key={d.id} className="border-b">
                          <td className="py-2 font-mono text-xs">
                            {d.creator_seller_id}
                          </td>
                          <td className="py-2">{d.status}</td>
                          <td className="py-2 text-right">
                            {formatCents(d.total_attributed_cents)}
                          </td>
                          <td className="py-2 text-right">
                            {formatCents(d.total_paid_out_cents)}
                          </td>
                          <td className="py-2 font-mono text-xs">
                            {d.default_affiliate_link_id ?? "—"}
                          </td>
                          <td className="py-2 text-right">
                            {d.status === "active" ? (
                              <Button
                                size="small"
                                variant="danger"
                                onClick={() =>
                                  void violateDeal(selectedProgram.id, d.id)
                                }
                              >
                                Mark violated
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <Text className="text-ui-fg-subtle italic">
              Select a program from the list to see applications and deals.
            </Text>
          )}
        </div>
      </div>
    </Container>
  )
}

const KV = ({ label, value }: { label: string; value: string }) => (
  <div>
    <Text className="text-ui-fg-subtle text-xs uppercase">{label}</Text>
    <div className="text-sm font-medium">{value}</div>
  </div>
)

const CreateProgramForm = ({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: () => Promise<void>
}) => {
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")
  const [programType, setProgramType] =
    useState<ProgramType>("affiliate_open")
  const [commissionPercent, setCommissionPercent] = useState("10")
  const [requiresKyc, setRequiresKyc] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!title || !slug) {
      toast.error("Title and slug required")
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        title,
        slug,
        description: description || null,
        program_type: programType,
        requires_kyc: requiresKyc,
      }
      const pct = parseFloat(commissionPercent)
      if (Number.isFinite(pct)) body.commission_percent = pct

      await authedFetch("/v1/seller/programs", {
        method: "POST",
        body: JSON.stringify(body),
      })
      toast.success("Program created (draft) — click Publish on its detail to activate")
      await onCreated()
    } catch (err) {
      toast.error("Failed to create program", {
        description: (err as Error).message,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border border-ui-border-base rounded-md p-4 flex flex-col gap-3">
      <Heading level="h2">New program</Heading>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="np-title">Title</Label>
          <Input
            id="np-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Spring launch — 10% to creators"
          />
        </div>
        <div>
          <Label htmlFor="np-slug">Slug</Label>
          <Input
            id="np-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="spring-launch"
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="np-desc">Description</Label>
          <Textarea
            id="np-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief for creators: what you want them to share, restrictions, hashtags."
          />
        </div>
        <div>
          <Label htmlFor="np-type">Program type</Label>
          <select
            id="np-type"
            className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base w-full"
            value={programType}
            onChange={(e) => setProgramType(e.target.value as ProgramType)}
          >
            <option value="affiliate_open">Affiliate (open to all)</option>
            <option value="affiliate_invite">Affiliate (invite-only)</option>
            <option value="sponsored_brief">Sponsored brief (flat fee)</option>
            <option value="commission_boost">Commission boost</option>
            <option value="engagement_pool">Engagement reward pool</option>
          </select>
        </div>
        <div>
          <Label htmlFor="np-pct">Commission %</Label>
          <Input
            id="np-pct"
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={commissionPercent}
            onChange={(e) => setCommissionPercent(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 mt-6">
          <input
            id="np-kyc"
            type="checkbox"
            checked={requiresKyc}
            onChange={(e) => setRequiresKyc(e.target.checked)}
          />
          <Label htmlFor="np-kyc">Require creator KYC verification</Label>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Creating..." : "Create draft"}
        </Button>
      </div>
    </div>
  )
}
