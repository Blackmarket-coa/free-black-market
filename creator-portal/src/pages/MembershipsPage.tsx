import { useState } from "react"
import { PageHeader } from "@/components/ui/PageHeader"
import { MetricCard } from "@/components/ui/MetricCard"
import { QueryState } from "@/components/ui/QueryState"
import { DataTable, Column } from "@/components/ui/DataTable"
import { useMembershipTiers, useMembers, useForceResync } from "@/hooks/useCreatorData"
import { money, shortDate, classNames } from "@bmc/portal-kit"
import type { Member, SyncStatus } from "@/types"

const STATUS_COLOR: Record<string, string> = {
  active: "text-forest-300",
  paused: "text-amber-300",
  past_due: "text-clay",
  cancelled: "text-ghost",
  expired: "text-ghost",
}

const SYNC_META: Record<SyncStatus, { dot: string; label: string; color: string }> = {
  in_sync: { dot: "🟢", label: "In sync", color: "text-forest-300" },
  drift: { dot: "🟡", label: "Drift", color: "text-amber-300" },
  no_mxid: { dot: "⚫", label: "No Blackout", color: "text-ghost" },
}

export function MembershipsPage() {
  const { data: tiers, isLoading, isError } = useMembershipTiers()
  const { data: members } = useMembers()
  const resync = useForceResync()

  const [banner, setBanner] = useState<string | null>(null)

  const mrr = (tiers ?? []).reduce((sum, t) => {
    const monthly = t.interval === "yearly" ? t.price_amount / 12 : t.price_amount
    return sum + monthly * t.active_members
  }, 0)
  const activeCount = (members ?? []).filter((m) => m.status === "active").length
  const noMxidCount = (members ?? []).filter((m) => m.sync_status === "no_mxid").length
  const driftCount = (members ?? []).filter((m) => m.sync_status === "drift").length

  function onForceSync() {
    setBanner(null)
    resync.mutate(undefined, {
      onSuccess: (r) =>
        setBanner(
          `Syncing ${r.queued} member${r.queued === 1 ? "" : "s"}… (est. ${r.estimated_seconds}s)` +
            (r.skipped_no_blackout_account
              ? ` · ${r.skipped_no_blackout_account} skipped (no Blackout account)`
              : "")
        ),
      onError: () => setBanner("Force sync failed — check your session and try again."),
    })
  }

  const columns: Column<Member>[] = [
    { key: "name", header: "Member", sortValue: (r) => r.name ?? r.email, render: (r) => <span className="text-cream-100">{r.name ?? r.email}</span> },
    { key: "tier", header: "Tier", sortValue: (r) => r.tier_name, render: (r) => <span className="text-mist">{r.tier_name}</span> },
    { key: "status", header: "Status", sortValue: (r) => r.status, render: (r) => <span className={classNames("capitalize", STATUS_COLOR[r.status])}>{r.status.replace("_", " ")}</span> },
    {
      key: "sync",
      header: "Blackout sync",
      sortValue: (r) => r.sync_status,
      render: (r) => {
        const m = SYNC_META[r.sync_status]
        return (
          <span className={classNames("inline-flex items-center gap-1.5", m.color)}>
            <span aria-hidden>{m.dot}</span>
            {m.label}
          </span>
        )
      },
    },
    { key: "renewal", header: "Renews", sortValue: (r) => r.next_renewal_at ?? "", render: (r) => <span className="text-mist">{shortDate(r.next_renewal_at)}</span> },
    { key: "ltv", header: "LTV", sortValue: (r) => r.ltv_amount, render: (r) => <span className="text-cream-100">{money(r.ltv_amount)}</span> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Memberships"
        subtitle="Subscription tiers, members, and their Blackout Space sync status."
        action={<button className="btn-primary text-sm">New tier</button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="MRR" value={money(mrr)} icon="💎" />
        <MetricCard label="Active members" value={activeCount} icon="👥" />
        <MetricCard label="In drift" value={driftCount} subtitle="tier ≠ room access" />
        <MetricCard label="No Blackout account" value={noMxidCount} />
      </div>

      {/* Sync control */}
      <section className="panel-pad flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="heading text-sm text-cream-50">Blackout room sync</div>
          <div className="text-xs text-mist mt-0.5">
            Re-emit membership state for every active member so Blackout reconciles
            Space room access. {noMxidCount > 0 && `${noMxidCount} members haven't linked a Blackout account.`}
          </div>
          {banner && <div className="text-xs text-amber-300 mt-2">{banner}</div>}
        </div>
        <div className="flex gap-2 shrink-0">
          {noMxidCount > 0 && <button className="btn-ghost text-sm">Send link reminder</button>}
          <button className="btn-primary text-sm" onClick={onForceSync} disabled={resync.isPending}>
            {resync.isPending ? "Syncing…" : "Force sync all members"}
          </button>
        </div>
      </section>

      <QueryState isLoading={isLoading} isError={isError}>
        <section>
          <h2 className="heading text-sm mb-2">Tiers</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {tiers?.map((t) => (
              <div key={t.id} className="panel-pad space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-cream-50 font-medium">{t.name}</div>
                  <span className="text-[10px] text-ghost rounded-full border border-moss px-1.5 py-0.5">
                    {t.blackout_tier}
                  </span>
                </div>
                <div className="text-lg text-cream-100">
                  {money(t.price_amount)}
                  <span className="text-xs text-ghost">/{t.interval === "yearly" ? "yr" : "mo"}</span>
                </div>
                <ul className="text-xs text-mist space-y-0.5 list-disc list-inside">
                  {t.perks.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <div className="text-xs text-amber-300 pt-1">
                  {t.active_members} active · {t.credits_per_period}₡/period
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="heading text-sm mb-2">Members</h2>
          <DataTable columns={columns} rows={members ?? []} exportName="creator-members" />
        </section>
      </QueryState>
    </div>
  )
}
