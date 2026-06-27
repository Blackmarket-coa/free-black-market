import { PageHeader } from "@/components/ui/PageHeader"
import { MetricCard } from "@/components/ui/MetricCard"
import { QueryState } from "@/components/ui/QueryState"
import { DataTable, Column } from "@/components/ui/DataTable"
import { useMembershipTiers, useMembers } from "@/hooks/useWellness"
import { money, shortDate, classNames } from "@/lib/format"
import type { Member } from "@/types"

const STATUS_COLOR: Record<string, string> = {
  active: "text-forest-300",
  paused: "text-amber-300",
  past_due: "text-clay",
  cancelled: "text-ghost",
  expired: "text-ghost",
}

export function MembershipsPage() {
  const { data: tiers, isLoading, isError } = useMembershipTiers()
  const { data: members } = useMembers()

  const mrr = (tiers ?? []).reduce((sum, t) => {
    const monthly = t.interval === "yearly" ? t.price_amount / 12 : t.price_amount
    return sum + monthly * t.active_members
  }, 0)
  const activeCount = (members ?? []).filter((m) => m.status === "active").length

  const columns: Column<Member>[] = [
    { key: "name", header: "Member", sortValue: (r) => r.name ?? r.email, render: (r) => <span className="text-cream-100">{r.name ?? r.email}</span> },
    { key: "tier", header: "Tier", sortValue: (r) => r.tier_name, render: (r) => <span className="text-mist">{r.tier_name}</span> },
    { key: "status", header: "Status", sortValue: (r) => r.status, render: (r) => <span className={classNames("capitalize", STATUS_COLOR[r.status])}>{r.status.replace("_", " ")}</span> },
    { key: "renewal", header: "Renews", sortValue: (r) => r.next_renewal_at ?? "", render: (r) => <span className="text-mist">{shortDate(r.next_renewal_at)}</span> },
    { key: "credits", header: "Credits", sortValue: (r) => r.credits_balance, render: (r) => <span className="text-mist">{r.credits_balance}</span> },
    { key: "ltv", header: "LTV", sortValue: (r) => r.ltv_amount, render: (r) => <span className="text-cream-100">{money(r.ltv_amount)}</span> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Memberships"
        subtitle="Subscription tiers, active members, and recurring revenue."
        action={<button className="btn-primary text-sm">New tier</button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="MRR" value={money(mrr)} icon="💎" />
        <MetricCard label="Active members" value={activeCount} icon="👥" />
        <MetricCard label="Tiers" value={tiers?.length ?? 0} />
        <MetricCard
          label="Credits outstanding"
          value={(members ?? []).reduce((s, m) => s + m.credits_balance, 0)}
        />
      </div>

      <QueryState isLoading={isLoading} isError={isError}>
        <section>
          <h2 className="heading text-sm mb-2">Tiers</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {tiers?.map((t) => (
              <div key={t.id} className="panel-pad space-y-2">
                <div className="text-cream-50 font-medium">{t.name}</div>
                <div className="text-lg text-cream-100">
                  {money(t.price_amount)}
                  <span className="text-xs text-ghost">/{t.interval === "yearly" ? "yr" : "mo"}</span>
                </div>
                <ul className="text-xs text-mist space-y-0.5 list-disc list-inside">
                  {t.perks.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <div className="text-xs text-amber-300 pt-1">{t.active_members} active</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="heading text-sm mb-2">Members</h2>
          <DataTable columns={columns} rows={members ?? []} exportName="wellness-members" />
        </section>
      </QueryState>
    </div>
  )
}
