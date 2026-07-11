import { useMakers } from "@/hooks/useMakers"
import { useOperatorType } from "@/hooks/useOperatorType"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { TierBadge } from "@bmc/ui"
import { EmptyState } from "@bmc/ui"
import { shortDate, classNames } from "@bmc/portal-kit"
import type { CollectiveMaker, CollectiveRole } from "@/types"

const ROLE_STYLE: Record<CollectiveRole, string> = {
  founder: "text-forest-300",
  member: "text-cream-100",
  apprentice: "text-amber-300",
}

// Self-relative bands, not a leaderboard: they describe each maker's own
// trajectory this period rather than ranking members against one another.
const BAND_META: Record<CollectiveMaker["contribution_band"], { label: string; className: string }> = {
  high: { label: "high output", className: "text-forest-300 border-forest-700" },
  steady: { label: "steady", className: "text-cream-100 border-moss" },
  ramping: { label: "ramping up", className: "text-amber-300 border-amber-700/50" },
}

// Collective only — guarded at the route level in App.tsx; the in-page guard
// covers direct navigation while running as a solo maker.
export function MakersPage() {
  const { isCollective } = useOperatorType()
  const { data, isLoading, isError } = useMakers()

  if (!isCollective) {
    return (
      <div>
        <PageHeader title="Makers" />
        <EmptyState
          icon="👥"
          title="Collective operators only"
          message="The maker roster applies to shared production houses."
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Makers"
        subtitle="Member roster, per-maker production, and onboarding"
        action={
          // POST /vendor/botanical/collective/invites — wired with the invite flow
          <button className="btn-primary text-sm" disabled>
            + Invite maker
          </button>
        }
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard label="Members" value={data.makers.length} icon="👥" />
              <MetricCard
                label="Active runs"
                value={data.makers.reduce((s, m) => s + m.active_runs, 0)}
                icon="⚗️"
              />
              <MetricCard
                label="Units this period"
                value={data.makers.reduce((s, m) => s + m.units_this_period, 0)}
                icon="🫙"
              />
              <MetricCard
                label="Pending invites"
                value={data.invites.filter((i) => i.status === "pending").length}
                icon="✉️"
              />
            </div>

            {/* Roster */}
            <section>
              <h2 className="heading text-base mb-2">Roster</h2>
              <div className="grid lg:grid-cols-2 gap-3">
                {data.makers.map((m) => (
                  <MakerCard key={m.id} maker={m} />
                ))}
              </div>
            </section>

            {/* Invites */}
            <section>
              <h2 className="heading text-base mb-2">Invites</h2>
              {data.invites.length === 0 ? (
                <div className="panel-pad text-sm text-mist">No outstanding invites.</div>
              ) : (
                <div className="panel divide-y divide-moss/50">
                  {data.invites.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span aria-hidden>✉️</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-cream-100 truncate">{inv.email}</div>
                        <div className="text-xs text-ghost">
                          invited by {inv.invited_by} · {shortDate(inv.invited_at)}
                        </div>
                      </div>
                      {inv.status === "pending" ? (
                        <span className="text-xs text-amber-300 shrink-0">pending</span>
                      ) : (
                        <span className="text-xs text-ghost shrink-0">
                          expired
                          <button className="btn-ghost text-[11px] ml-2">Resend</button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </QueryState>
    </div>
  )
}

function MakerCard({ maker }: { maker: CollectiveMaker }) {
  const band = BAND_META[maker.contribution_band]
  return (
    <div className="panel-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-cream-50 font-medium truncate">{maker.name}</div>
          <div className="text-[11px] text-ghost">
            <span className={classNames("capitalize", ROLE_STYLE[maker.role])}>{maker.role}</span>
            {" · "}joined {shortDate(maker.joined_at)} · {maker.karma} KARMA
          </div>
        </div>
        <TierBadge tier={maker.tier} />
      </div>

      {/* Active pathways */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {maker.active_pathway_names.map((p) => (
          <span
            key={p}
            className="text-[11px] text-mist border border-moss rounded-sm px-1.5 py-0.5"
          >
            {p}
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-ghost">Active runs</div>
          <div className="text-cream-100 mt-0.5">{maker.active_runs}</div>
        </div>
        <div>
          <div className="text-ghost">Units this period</div>
          <div className="text-cream-100 mt-0.5">{maker.units_this_period}</div>
        </div>
        <div>
          <div className="text-ghost">Contribution</div>
          <div className="mt-0.5">
            <span
              className={classNames("border rounded-sm px-1.5 py-0.5 text-[11px]", band.className)}
            >
              {band.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
