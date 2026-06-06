import { useEffect, useMemo, useState } from "react"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { backendUrl, getAuthToken } from "../../lib/client"

// Bounty-flavoured service program types. The Services surface covers the full
// catalogue (contracts, pools, subcontracts); this page narrows to the two
// bounty types so vendors see bounties as a first-class growth lever.
const BOUNTY_PROGRAM_TYPES = ["bounty_open", "bounty_invite"] as const
const isBounty = (programType: string) =>
  (BOUNTY_PROGRAM_TYPES as readonly string[]).includes(programType)

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
  status: string
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

const formatCents = (cents: number | null | undefined, currency = "USD") =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
        Number(cents) / 100
      )

const formatDate = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—"

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

export const BountiesPage = () => {
  const [tab, setTab] = useState<"mine" | "open">("mine")
  const [myPrograms, setMyPrograms] = useState<ServiceProgramRow[]>([])
  const [myApplications, setMyApplications] = useState<ServiceApplicationRow[]>(
    []
  )
  const [openMarketplace, setOpenMarketplace] = useState<OpenServiceProgram[]>(
    []
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const [programs, applications, open] = await Promise.all([
        authedFetch<{ programs: ServiceProgramRow[] }>(
          "/v1/seller/services/programs"
        ).catch(() => ({ programs: [] })),
        authedFetch<{ applications: ServiceApplicationRow[] }>(
          "/v1/seller/services/applications"
        ).catch(() => ({ applications: [] })),
        authedFetch<{ programs: OpenServiceProgram[] }>(
          "/v1/marketplace/services?limit=100"
        ).catch(() => ({ programs: [] })),
      ])
      setMyPrograms((programs.programs || []).filter((p) => isBounty(p.program_type)))
      setMyApplications(applications.applications || [])
      setOpenMarketplace(
        (open.programs || []).filter((p) => isBounty(p.program_type))
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  // Applicant counts keyed by program so each of my bounties shows traction.
  const applicantsByProgram = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of myApplications) {
      map.set(a.program_id, (map.get(a.program_id) || 0) + 1)
    }
    return map
  }, [myApplications])

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Bounties</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Post bounties to recruit creators and service providers, and browse
            open bounties you can claim.
          </Text>
        </div>
        <Button variant="secondary" onClick={reload} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="flex gap-2 px-6 py-3">
        <Button
          size="small"
          variant={tab === "mine" ? "primary" : "secondary"}
          onClick={() => setTab("mine")}
        >
          My bounties
        </Button>
        <Button
          size="small"
          variant={tab === "open" ? "primary" : "secondary"}
          onClick={() => setTab("open")}
        >
          Open bounties
        </Button>
      </div>

      {loading ? (
        <div className="px-6 py-8">
          <Text className="text-ui-fg-subtle">Loading bounties…</Text>
        </div>
      ) : error ? (
        <div className="px-6 py-8">
          <Text className="text-ui-fg-error">{error}</Text>
        </div>
      ) : tab === "mine" ? (
        myPrograms.length === 0 ? (
          <div className="px-6 py-8">
            <Text className="text-ui-fg-subtle">
              You haven't posted any bounties yet. Launch a product from Find
              Creators or post a service bounty to get started.
            </Text>
          </div>
        ) : (
          <ul className="divide-y">
            {myPrograms.map((p) => (
              <li key={p.id} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Text weight="plus" className="truncate">
                        {p.title}
                      </Text>
                      <Badge size="2xsmall">{p.program_type}</Badge>
                      <Badge
                        size="2xsmall"
                        color={p.status === "open" ? "green" : "grey"}
                      >
                        {p.status}
                      </Badge>
                    </div>
                    <Text size="small" className="text-ui-fg-subtle">
                      {p.service_category} ·{" "}
                      {formatCents(p.unit_price_cents, p.currency_code)} ·{" "}
                      {applicantsByProgram.get(p.id) || 0} applicant(s)
                    </Text>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : openMarketplace.length === 0 ? (
        <div className="px-6 py-8">
          <Text className="text-ui-fg-subtle">
            No open bounties right now. Check back soon.
          </Text>
        </div>
      ) : (
        <ul className="divide-y">
          {openMarketplace.map((p) => (
            <li key={p.id} className="px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Text weight="plus" className="truncate">
                      {p.title}
                    </Text>
                    <Badge size="2xsmall">{p.program_type}</Badge>
                  </div>
                  <Text size="small" className="text-ui-fg-subtle">
                    {p.service_category} ·{" "}
                    {formatCents(
                      p.unit_price_cents ?? p.flat_price_cents ?? p.pool_total_cents,
                      p.currency_code
                    )}
                    {p.deadline_at ? ` · due ${formatDate(p.deadline_at)}` : ""}
                  </Text>
                </div>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() =>
                    toast.info("Claim bounties from the Services page")
                  }
                >
                  View
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Container>
  )
}

export default BountiesPage
