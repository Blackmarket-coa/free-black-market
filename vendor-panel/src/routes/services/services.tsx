import { useEffect, useMemo, useState } from "react"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { backendUrl, getAuthToken } from "../../lib/client"

const CATEGORIES = [
  "apparel_press",
  "packaging",
  "photography",
  "design",
  "fulfillment",
  "courier",
  "repair",
  "fabrication",
  "co_packing",
  "assembly",
  "custom",
] as const

const PROGRAM_TYPES = [
  "bounty_open",
  "bounty_invite",
  "fixed_contract",
  "throughput_pool",
  "order_subcontract",
] as const

const PRICING_MODELS = ["per_unit", "per_hour", "flat", "tiered"] as const

const PROOF_KINDS = [
  "photo",
  "video",
  "document",
  "shipping_label",
  "tracking_event",
  "iot_sensor_log",
  "signed_manifest",
  "third_party_attestation",
  "onchain_receipt",
] as const

interface ServiceProgramRow {
  id: string
  vendor_id: string
  title: string
  slug: string
  description: string | null
  service_category: string
  program_type: string
  pricing_model: string
  status: string
  unit_price_cents: number | null
  currency_code: string
  requires_kyc: boolean
}

interface ServiceApplicationRow {
  id: string
  program_id: string
  service_seller_id: string
  pitch: string | null
  proposed_unit_price_cents: number | null
  proposed_capacity: number | null
  status: string
  decided_at: string | null
  decision_reason: string | null
}

interface ServiceContractRow {
  id: string
  program_id: string
  service_seller_id: string
  vendor_id: string
  status: string
  total_paid_cents: number
  effective_until: string | null
}

interface OpenServiceProgram {
  id: string
  vendor_id: string
  title: string
  service_category: string
  program_type: string
  pricing_model: string
  unit_price_cents: number | null
  flat_price_cents: number | null
  pool_total_cents: number | null
  currency_code: string
  deadline_at: string | null
  requires_kyc: boolean
}

interface SubcontractRow {
  id: string
  parent_order_id: string
  parent_seller_id: string
  subcontract_seller_id: string
  contract_id: string
  status: string
  unit_count: number
  unit_price_cents: number
  total_cents: number
  currency_code: string
  dispute_reason: string | null
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

export const ServicesPage = () => {
  const [tab, setTab] = useState<
    "buying" | "providing" | "marketplace" | "subcontracts"
  >("buying")
  const [myPrograms, setMyPrograms] = useState<ServiceProgramRow[]>([])
  const [myApplications, setMyApplications] = useState<ServiceApplicationRow[]>([])
  const [contractsAsBuyer, setContractsAsBuyer] = useState<ServiceContractRow[]>([])
  const [contractsAsProvider, setContractsAsProvider] = useState<ServiceContractRow[]>([])
  const [openMarketplace, setOpenMarketplace] = useState<OpenServiceProgram[]>([])
  const [subcontractsAsParent, setSubcontractsAsParent] = useState<SubcontractRow[]>([])
  const [subcontractsAsProvider, setSubcontractsAsProvider] = useState<SubcontractRow[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showSubcontract, setShowSubcontract] = useState<string | null>(null) // contract_id
  const [loading, setLoading] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const [
        { programs },
        { applications },
        { as_buyer, as_provider },
        { programs: openPrograms },
        { as_parent, as_provider: subAsProvider },
      ] = await Promise.all([
        authedFetch<{ programs: ServiceProgramRow[] }>(
          "/v1/seller/services/programs"
        ),
        authedFetch<{ applications: ServiceApplicationRow[] }>(
          "/v1/seller/services/applications"
        ),
        authedFetch<{ as_buyer: ServiceContractRow[]; as_provider: ServiceContractRow[] }>(
          "/v1/seller/services/contracts"
        ),
        authedFetch<{ programs: OpenServiceProgram[] }>(
          "/v1/marketplace/services?limit=100"
        ),
        authedFetch<{ as_parent: SubcontractRow[]; as_provider: SubcontractRow[] }>(
          "/v1/seller/services/subcontracts"
        ),
      ])
      setMyPrograms(programs)
      setMyApplications(applications)
      setContractsAsBuyer(as_buyer)
      setContractsAsProvider(as_provider)
      setOpenMarketplace(openPrograms)
      setSubcontractsAsParent(as_parent)
      setSubcontractsAsProvider(subAsProvider)
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
  }, [])

  const publishProgram = async (id: string) => {
    try {
      await authedFetch(`/v1/seller/services/programs/${id}/publish`, {
        method: "POST",
      })
      toast.success("Program published")
      await reload()
    } catch (err) {
      toast.error("Publish failed", { description: (err as Error).message })
    }
  }

  const apply = async (programId: string, pitch: string, unitPriceCents?: number) => {
    try {
      const body: Record<string, unknown> = { program_id: programId, pitch }
      if (unitPriceCents !== undefined && Number.isFinite(unitPriceCents)) {
        body.proposed_unit_price_cents = unitPriceCents
      }
      await authedFetch("/v1/seller/services/applications", {
        method: "POST",
        body: JSON.stringify(body),
      })
      toast.success("Application submitted")
      await reload()
    } catch (err) {
      toast.error("Apply failed", { description: (err as Error).message })
    }
  }

  const acceptSubcontract = async (id: string) => {
    try {
      await authedFetch(`/v1/seller/services/subcontracts/${id}/accept`, {
        method: "POST",
      })
      toast.success("Subcontract accepted")
      await reload()
    } catch (err) {
      toast.error("Accept failed", { description: (err as Error).message })
    }
  }

  const acceptDelivery = async (id: string) => {
    if (!window.confirm("Accept delivery and release escrow?")) return
    try {
      await authedFetch(`/v1/seller/services/subcontracts/${id}/accept-delivery`, {
        method: "POST",
      })
      toast.success("Escrow released to service vendor")
      await reload()
    } catch (err) {
      toast.error("Accept-delivery failed", { description: (err as Error).message })
    }
  }

  const dispute = async (id: string) => {
    const reason = window.prompt("Dispute reason:")
    if (!reason || reason.trim().length < 2) return
    try {
      await authedFetch(`/v1/seller/services/subcontracts/${id}/dispute`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      })
      toast.success("Dispute filed; admin will review")
      await reload()
    } catch (err) {
      toast.error("Dispute failed", { description: (err as Error).message })
    }
  }

  return (
    <Container className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Heading level="h1">Services</Heading>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={tab === "buying" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("buying")}
          >
            I need services
          </Button>
          <Button
            variant={tab === "providing" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("providing")}
          >
            I provide services
          </Button>
          <Button
            variant={tab === "marketplace" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("marketplace")}
          >
            Open bounties ({openMarketplace.length})
          </Button>
          <Button
            variant={tab === "subcontracts" ? "primary" : "secondary"}
            size="small"
            onClick={() => setTab("subcontracts")}
          >
            Subcontracts
          </Button>
        </div>
      </div>

      {tab === "buying" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowCreate(true)}>+ Post a service program</Button>
          </div>
          {showCreate && (
            <CreateServiceProgramForm
              onCancel={() => setShowCreate(false)}
              onCreated={async () => {
                setShowCreate(false)
                await reload()
              }}
            />
          )}
          <div className="border border-ui-border-base rounded-md p-4">
            <Heading level="h2" className="mb-3">
              My service programs ({myPrograms.length})
            </Heading>
            {myPrograms.length === 0 ? (
              <Text className="text-ui-fg-subtle italic">
                No service programs yet. Post one to recruit specialists for press / packaging / fulfillment / etc.
              </Text>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ui-fg-subtle border-b">
                    <th className="py-2">Title</th>
                    <th className="py-2">Category</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Status</th>
                    <th className="py-2 text-right">Unit price</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {myPrograms.map((p) => (
                    <tr key={p.id} className="border-b">
                      <td className="py-2">
                        <div className="font-medium">{p.title}</div>
                        <div className="text-xs text-ui-fg-subtle font-mono">{p.slug}</div>
                      </td>
                      <td className="py-2">{p.service_category}</td>
                      <td className="py-2">{p.program_type}</td>
                      <td className="py-2">{p.status}</td>
                      <td className="py-2 text-right">
                        {formatCents(p.unit_price_cents, p.currency_code.toUpperCase())}
                      </td>
                      <td className="py-2 text-right">
                        {p.status === "draft" ? (
                          <Button
                            size="small"
                            onClick={() => void publishProgram(p.id)}
                          >
                            Publish
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="border border-ui-border-base rounded-md p-4">
            <Heading level="h2" className="mb-3">
              Active service contracts (work I'm buying)
            </Heading>
            <ContractsTable rows={contractsAsBuyer} onSubcontract={setShowSubcontract} />
          </div>
          {showSubcontract && (
            <CreateSubcontractForm
              contractId={showSubcontract}
              onCancel={() => setShowSubcontract(null)}
              onCreated={async () => {
                setShowSubcontract(null)
                setTab("subcontracts")
                await reload()
              }}
            />
          )}
        </div>
      )}

      {tab === "providing" && (
        <div className="flex flex-col gap-4">
          <div className="border border-ui-border-base rounded-md p-4">
            <Heading level="h2" className="mb-3">
              My applications
            </Heading>
            {myApplications.length === 0 ? (
              <Text className="text-ui-fg-subtle italic">
                You haven't applied to any service programs. Browse "Open bounties" to find work.
              </Text>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ui-fg-subtle border-b">
                    <th className="py-2">Program</th>
                    <th className="py-2">Status</th>
                    <th className="py-2 text-right">Proposed price</th>
                    <th className="py-2 text-right">Capacity</th>
                    <th className="py-2">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {myApplications.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="py-2 font-mono text-xs">{a.program_id}</td>
                      <td className="py-2">{a.status}</td>
                      <td className="py-2 text-right">
                        {formatCents(a.proposed_unit_price_cents)}
                      </td>
                      <td className="py-2 text-right">{a.proposed_capacity ?? "—"}</td>
                      <td className="py-2 text-xs text-ui-fg-subtle">
                        {a.decision_reason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="border border-ui-border-base rounded-md p-4">
            <Heading level="h2" className="mb-3">
              Active contracts (work I'm doing)
            </Heading>
            <ContractsTable rows={contractsAsProvider} />
          </div>
        </div>
      )}

      {tab === "marketplace" && (
        <div className="flex flex-col gap-3">
          {openMarketplace.length === 0 ? (
            <Text className="text-ui-fg-subtle italic">
              No open bounties available right now. Check back later.
            </Text>
          ) : null}
          {openMarketplace.map((p) => {
            const myApp = myApplications.find((a) => a.program_id === p.id)
            return (
              <OpenBountyCard
                key={p.id}
                program={p}
                myApplication={myApp}
                onApply={apply}
              />
            )
          })}
        </div>
      )}

      {tab === "subcontracts" && (
        <div className="flex flex-col gap-4">
          <div className="border border-ui-border-base rounded-md p-4">
            <Heading level="h2" className="mb-3">
              Subcontracts I'm running ({subcontractsAsParent.length})
            </Heading>
            <SubcontractsTable
              rows={subcontractsAsParent}
              perspective="parent"
              onAcceptDelivery={acceptDelivery}
              onDispute={dispute}
            />
          </div>
          <div className="border border-ui-border-base rounded-md p-4">
            <Heading level="h2" className="mb-3">
              Subcontracts assigned to me ({subcontractsAsProvider.length})
            </Heading>
            <SubcontractsTable
              rows={subcontractsAsProvider}
              perspective="provider"
              onAccept={acceptSubcontract}
              onDispute={dispute}
            />
          </div>
        </div>
      )}
    </Container>
  )
}

const ContractsTable = ({
  rows,
  onSubcontract,
}: {
  rows: ServiceContractRow[]
  onSubcontract?: (contractId: string) => void
}) =>
  rows.length === 0 ? (
    <Text className="text-ui-fg-subtle italic">No active contracts.</Text>
  ) : (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-ui-fg-subtle border-b">
          <th className="py-2">Contract</th>
          <th className="py-2">Program</th>
          <th className="py-2">Counterparty</th>
          <th className="py-2">Status</th>
          <th className="py-2 text-right">Paid out</th>
          <th className="py-2">Until</th>
          <th className="py-2"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="border-b">
            <td className="py-2 font-mono text-xs">{c.id}</td>
            <td className="py-2 font-mono text-xs">{c.program_id}</td>
            <td className="py-2 font-mono text-xs">{c.service_seller_id}</td>
            <td className="py-2">{c.status}</td>
            <td className="py-2 text-right">{formatCents(c.total_paid_cents)}</td>
            <td className="py-2">{formatDate(c.effective_until)}</td>
            <td className="py-2 text-right">
              {onSubcontract && c.status !== "canceled" ? (
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => onSubcontract(c.id)}
                >
                  + Subcontract
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )

const SubcontractsTable = ({
  rows,
  perspective,
  onAccept,
  onAcceptDelivery,
  onDispute,
}: {
  rows: SubcontractRow[]
  perspective: "parent" | "provider"
  onAccept?: (id: string) => void
  onAcceptDelivery?: (id: string) => void
  onDispute?: (id: string) => void
}) =>
  rows.length === 0 ? (
    <Text className="text-ui-fg-subtle italic">No subcontracts.</Text>
  ) : (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-ui-fg-subtle border-b">
          <th className="py-2">Subcontract</th>
          <th className="py-2">Order</th>
          <th className="py-2">Status</th>
          <th className="py-2 text-right">Units</th>
          <th className="py-2 text-right">Total</th>
          <th className="py-2">Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id} className="border-b align-top">
            <td className="py-2 font-mono text-xs">{s.id}</td>
            <td className="py-2 font-mono text-xs">{s.parent_order_id}</td>
            <td className="py-2">
              {s.status}
              {s.dispute_reason ? (
                <div className="text-xs text-ui-fg-subtle italic mt-1">
                  {s.dispute_reason}
                </div>
              ) : null}
            </td>
            <td className="py-2 text-right">{s.unit_count}</td>
            <td className="py-2 text-right">
              {formatCents(s.total_cents, s.currency_code.toUpperCase())}
            </td>
            <td className="py-2">
              <div className="flex flex-col gap-1">
                {perspective === "provider" && s.status === "proposed" && onAccept ? (
                  <Button
                    size="small"
                    onClick={() => onAccept(s.id)}
                  >
                    Accept
                  </Button>
                ) : null}
                {perspective === "provider" && (s.status === "accepted" || s.status === "in_progress") ? (
                  <DeliverButton subcontractId={s.id} />
                ) : null}
                {perspective === "parent" && s.status === "delivered" && onAcceptDelivery ? (
                  <Button
                    size="small"
                    onClick={() => onAcceptDelivery(s.id)}
                  >
                    Accept delivery & release
                  </Button>
                ) : null}
                {onDispute && s.status !== "accepted_by_parent" && s.status !== "canceled" ? (
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => onDispute(s.id)}
                  >
                    Dispute
                  </Button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )

const DeliverButton = ({ subcontractId }: { subcontractId: string }) => {
  const [showForm, setShowForm] = useState(false)
  return showForm ? (
    <DeliverForm
      subcontractId={subcontractId}
      onClose={() => setShowForm(false)}
    />
  ) : (
    <Button size="small" onClick={() => setShowForm(true)}>
      Deliver
    </Button>
  )
}

const DeliverForm = ({
  subcontractId,
  onClose,
}: {
  subcontractId: string
  onClose: () => void
}) => {
  const [proofKind, setProofKind] = useState("photo")
  const [proofUrl, setProofUrl] = useState("")
  const [proofSha, setProofSha] = useState("")
  const [unitsDelivered, setUnitsDelivered] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        proofs: [
          {
            kind: proofKind,
            storage_url: proofUrl || null,
            sha256: proofSha || null,
            captured_at: new Date().toISOString(),
          },
        ],
      }
      const u = parseInt(unitsDelivered, 10)
      if (Number.isFinite(u) && u >= 0) body.units_delivered = u
      await authedFetch(`/v1/seller/services/subcontracts/${subcontractId}/deliver`, {
        method: "POST",
        body: JSON.stringify(body),
      })
      toast.success("Delivered; awaiting buyer acceptance")
      onClose()
      window.location.reload()
    } catch (err) {
      toast.error("Deliver failed", { description: (err as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-2 border border-ui-border-base rounded">
      <select
        className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base text-xs"
        value={proofKind}
        onChange={(e) => setProofKind(e.target.value)}
      >
        {PROOF_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <Input
        placeholder="Proof URL (e.g. uploaded photo URL)"
        value={proofUrl}
        onChange={(e) => setProofUrl(e.target.value)}
      />
      <Input
        placeholder="sha256 of proof file (hex, optional)"
        value={proofSha}
        onChange={(e) => setProofSha(e.target.value)}
      />
      <Input
        placeholder="Units delivered (optional)"
        value={unitsDelivered}
        onChange={(e) => setUnitsDelivered(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="small" onClick={submit} disabled={submitting}>
          Submit
        </Button>
        <Button size="small" variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

const OpenBountyCard = ({
  program,
  myApplication,
  onApply,
}: {
  program: OpenServiceProgram
  myApplication?: ServiceApplicationRow
  onApply: (id: string, pitch: string, unitPriceCents?: number) => Promise<void>
}) => {
  const [pitch, setPitch] = useState("")
  const [unitPrice, setUnitPrice] = useState("")
  return (
    <div className="border border-ui-border-base rounded-md p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <Heading level="h3">{program.title}</Heading>
          <Text className="text-xs text-ui-fg-subtle">
            {program.service_category} · {program.program_type} ·{" "}
            {program.pricing_model}
            {program.unit_price_cents
              ? ` · ${formatCents(program.unit_price_cents, program.currency_code.toUpperCase())} / unit`
              : program.flat_price_cents
              ? ` · flat ${formatCents(program.flat_price_cents, program.currency_code.toUpperCase())}`
              : ""}
            {program.requires_kyc ? " · KYC required" : ""}
            {program.deadline_at
              ? ` · deadline ${formatDate(program.deadline_at)}`
              : ""}
          </Text>
        </div>
      </div>
      {myApplication ? (
        <Text className="text-sm mt-2">
          Application status: <strong>{myApplication.status}</strong>
          {myApplication.decision_reason ? ` — ${myApplication.decision_reason}` : ""}
        </Text>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea
            rows={2}
            placeholder="Pitch (capacity, lead time, portfolio links)"
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
          />
          <Input
            placeholder="Proposed unit price in cents (optional)"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
          <div>
            <Button
              size="small"
              onClick={() => {
                const cents = parseInt(unitPrice, 10)
                void onApply(
                  program.id,
                  pitch,
                  Number.isFinite(cents) ? cents : undefined
                )
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

const CreateServiceProgramForm = ({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: () => Promise<void>
}) => {
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")
  const [serviceCategory, setServiceCategory] = useState("apparel_press")
  const [programType, setProgramType] = useState("bounty_open")
  const [pricingModel, setPricingModel] = useState("per_unit")
  const [unitPriceCents, setUnitPriceCents] = useState("500")
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
        service_category: serviceCategory,
        program_type: programType,
        pricing_model: pricingModel,
        requires_kyc: requiresKyc,
      }
      const cents = parseInt(unitPriceCents, 10)
      if (Number.isFinite(cents) && cents >= 0) {
        if (pricingModel === "per_unit") body.unit_price_cents = cents
        else if (pricingModel === "flat") body.flat_price_cents = cents
        else if (pricingModel === "per_hour") body.hourly_rate_cents = cents
      }
      await authedFetch("/v1/seller/services/programs", {
        method: "POST",
        body: JSON.stringify(body),
      })
      toast.success("Service program created (draft) — click Publish to activate")
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
      <Heading level="h2">Post a service program</Heading>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="sp-title">Title</Label>
          <Input
            id="sp-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="T-shirt press capacity for spring orders"
          />
        </div>
        <div>
          <Label htmlFor="sp-slug">Slug</Label>
          <Input
            id="sp-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="apparel-press-spring"
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="sp-desc">Description / brief</Label>
          <Textarea
            id="sp-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Spec sheet, materials, tolerances, deadline expectations."
          />
        </div>
        <div>
          <Label htmlFor="sp-cat">Category</Label>
          <select
            id="sp-cat"
            className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base w-full"
            value={serviceCategory}
            onChange={(e) => setServiceCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="sp-type">Program type</Label>
          <select
            id="sp-type"
            className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base w-full"
            value={programType}
            onChange={(e) => setProgramType(e.target.value)}
          >
            {PROGRAM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="sp-pricing">Pricing model</Label>
          <select
            id="sp-pricing"
            className="border border-ui-border-base rounded px-2 py-1 bg-ui-bg-base w-full"
            value={pricingModel}
            onChange={(e) => setPricingModel(e.target.value)}
          >
            {PRICING_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="sp-price">Unit/flat/hour price (cents)</Label>
          <Input
            id="sp-price"
            type="number"
            min="0"
            value={unitPriceCents}
            onChange={(e) => setUnitPriceCents(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 mt-6">
          <input
            id="sp-kyc"
            type="checkbox"
            checked={requiresKyc}
            onChange={(e) => setRequiresKyc(e.target.checked)}
          />
          <Label htmlFor="sp-kyc">Require KYC verification</Label>
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

const CreateSubcontractForm = ({
  contractId,
  onCancel,
  onCreated,
}: {
  contractId: string
  onCancel: () => void
  onCreated: () => Promise<void>
}) => {
  const [orderId, setOrderId] = useState("")
  const [orderItemIds, setOrderItemIds] = useState("")
  const [unitCount, setUnitCount] = useState("1")
  const [unitPriceCents, setUnitPriceCents] = useState("500")
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!orderId || !orderItemIds) {
      toast.error("Order id and item ids required")
      return
    }
    setSubmitting(true)
    try {
      const ids = orderItemIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      await authedFetch("/v1/seller/services/subcontracts", {
        method: "POST",
        body: JSON.stringify({
          parent_order_id: orderId,
          contract_id: contractId,
          order_item_ids: ids,
          unit_count: parseInt(unitCount, 10) || 1,
          unit_price_cents: parseInt(unitPriceCents, 10) || 500,
        }),
      })
      toast.success("Subcontract proposed; escrow opened")
      await onCreated()
    } catch (err) {
      toast.error("Subcontract failed", {
        description: (err as Error).message,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border border-ui-border-base rounded-md p-4 flex flex-col gap-3">
      <Heading level="h2">Subcontract on contract {contractId}</Heading>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="sc-order">Parent order id</Label>
          <Input
            id="sc-order"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="sc-items">Order item ids (comma-separated)</Label>
          <Input
            id="sc-items"
            value={orderItemIds}
            onChange={(e) => setOrderItemIds(e.target.value)}
            placeholder="ord_item_1,ord_item_2"
          />
        </div>
        <div>
          <Label htmlFor="sc-units">Unit count</Label>
          <Input
            id="sc-units"
            type="number"
            min="1"
            value={unitCount}
            onChange={(e) => setUnitCount(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="sc-price">Unit price (cents)</Label>
          <Input
            id="sc-price"
            type="number"
            min="1"
            value={unitPriceCents}
            onChange={(e) => setUnitPriceCents(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Opening escrow..." : "Propose subcontract"}
        </Button>
      </div>
    </div>
  )
}
