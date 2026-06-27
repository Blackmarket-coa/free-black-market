import { useState } from "react"
import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { DataTable, Column } from "@/components/ui/DataTable"
import { useClients } from "@/hooks/useWellness"
import { money, shortDate, daysUntil, classNames } from "@/lib/format"
import type { ClientProfile } from "@/types"

export function ClientsPage() {
  const { data, isLoading, isError } = useClients()
  const [q, setQ] = useState("")

  const rows = (data ?? []).filter(
    (c) =>
      !q ||
      (c.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
      c.email.toLowerCase().includes(q.toLowerCase())
  )

  const isLapsed = (c: ClientProfile) => {
    const d = daysUntil(c.last_seen_at)
    return d !== null && d < -90
  }

  const columns: Column<ClientProfile>[] = [
    { key: "name", header: "Client", sortValue: (r) => r.name ?? r.email, render: (r) => (
      <div>
        <div className="text-cream-100">{r.name ?? r.email}</div>
        <div className="text-xs text-ghost">{r.email}</div>
      </div>
    ) },
    { key: "tier", header: "Tier", sortValue: (r) => r.tier_name ?? "", render: (r) => <span className="text-mist">{r.tier_name ?? "—"}</span> },
    { key: "tags", header: "Tags", render: (r) => (
      <div className="flex flex-wrap gap-1">
        {(r.tags ?? []).map((t) => (
          <span key={t} className="rounded-full bg-moss/60 px-2 py-0.5 text-[10px] text-mist">{t}</span>
        ))}
      </div>
    ) },
    { key: "sessions", header: "Sessions", sortValue: (r) => r.total_bookings, render: (r) => <span className="text-mist">{r.total_bookings}</span> },
    { key: "ltv", header: "Spend", sortValue: (r) => r.lifetime_value_amount, render: (r) => <span className="text-cream-100">{money(r.lifetime_value_amount)}</span> },
    { key: "last", header: "Last seen", sortValue: (r) => r.last_seen_at ?? "", render: (r) => (
      <span className={classNames(isLapsed(r) ? "text-clay" : "text-mist")}>
        {shortDate(r.last_seen_at)}
        {isLapsed(r) && " · lapsed"}
      </span>
    ) },
    { key: "act", header: "", render: (r) => (
      isLapsed(r) ? <button className="btn-ghost text-xs">Re-engage</button> : <button className="btn-ghost text-xs">DM</button>
    ) },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clients"
        subtitle="Your client CRM. Notes and intake data stay private to you."
      />
      <div className="panel-pad text-xs text-mist">
        🔒 Client data is stored scoped to your account. Session notes are never shared with
        clients or third parties. Blackout messages are end-to-end encrypted.
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or email…"
        className="w-full md:w-80 bg-soil border border-moss rounded-sm px-3 py-1.5 text-sm text-cream-100 placeholder:text-ghost focus:outline-none focus:border-amber-600"
      />
      <QueryState isLoading={isLoading} isError={isError}>
        <DataTable columns={columns} rows={rows} exportName="wellness-clients" />
      </QueryState>
    </div>
  )
}
