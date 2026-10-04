import type { Metadata } from "next"
import { notFound } from "next/navigation"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import {
  getCampaign,
  getCampaignImpactReport,
  getCampaignProgress,
  type CampaignDashboard,
  type CampaignImpactReport,
  type CampaignProgress,
} from "@/lib/data/collective"
import { phase1ModuleFlags } from "@/lib/feature-flags"

type Params = { params: Promise<{ id: string }> }

const isSharedGoal = (dashboard: CampaignDashboard) => dashboard.campaign.goal_kind === "SHARED_GOAL"

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  try {
    const dashboard = await getCampaign(id)
    if (isSharedGoal(dashboard)) {
      if (!phase1ModuleFlags.sharedGoalCoalition) return { title: "Campaign" }
      return {
        title: `${dashboard.campaign.name} — Shared Goal`,
        description: dashboard.campaign.description?.slice(0, 200),
      }
    }
    return {
      title: `${dashboard.campaign.name} — Production Campaign`,
      description: dashboard.campaign.description?.slice(0, 200),
    }
  } catch {
    return { title: "Campaign" }
  }
}

const money = (value: number | string | null | undefined) => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"
}

/** Shared-goal figures arrive as integer cents. */
const cents = (value: number | null | undefined) => money((value ?? 0) / 100)

const ROLE_LABELS: Record<string, string> = {
  HOST: "Host",
  COLLECTIVE: "Collective",
  PARTNER: "Partner organisation",
  SPONSOR: "Sponsor",
}

export default async function CampaignPage({ params }: Params) {
  const { id } = await params

  let dashboard
  try {
    dashboard = await getCampaign(id)
  } catch {
    notFound()
  }

  if (isSharedGoal(dashboard)) {
    // Dark with the flag: the API 404s the progress read too, so there is
    // nothing truthful to render without it.
    if (!phase1ModuleFlags.sharedGoalCoalition) notFound()

    let progress: CampaignProgress
    let report: CampaignImpactReport | null = null
    try {
      progress = await getCampaignProgress(id)
    } catch {
      notFound()
    }
    try {
      report = await getCampaignImpactReport(id)
    } catch {
      report = null
    }
    return <SharedGoalPage progress={progress} report={report} />
  }

  const { campaign, allocation_breakdown, material_line_items, backing_summary } = dashboard

  const goal = Number(campaign.campaign_goal ?? 0)
  const backed = Number(backing_summary.total_backed_amount ?? 0)
  const percent = goal ? Math.min(100, Math.round((backed / goal) * 100)) : 0

  // The allocation rows, in the order a backer should read them: what their
  // money buys, then what the maker is paid, then what the platform takes.
  const allocation = [
    {
      label: "Materials, paid direct to suppliers",
      value: allocation_breakdown.material_total,
      note: "Never passes through the maker's hands.",
    },
    {
      label: "Maker fee",
      value: allocation_breakdown.maker_fee_subtotal,
      note: "Released against milestones, not up front.",
    },
    { label: "Platform fee", value: allocation_breakdown.platform_fee_subtotal, note: null },
    { label: "Shipping", value: allocation_breakdown.shipping_subtotal, note: null },
  ]

  return (
    <main className="container py-10">
      <LocalizedClientLink
        href="/collective/campaigns"
        className="mb-4 inline-block text-sm underline"
      >
        ← All campaigns
      </LocalizedClientLink>

      <div className="mb-1 text-xs uppercase text-ui-fg-subtle">
        {campaign.campaign_type} · {campaign.status}
      </div>
      <h1 className="mb-3 text-2xl font-semibold">{campaign.name}</h1>
      <p className="mb-6 max-w-3xl text-sm text-ui-fg-subtle">{campaign.description}</p>

      <section className="mb-8 max-w-xl">
        <div className="mb-1 text-sm">
          <strong>{money(backed)}</strong> of {money(goal)} backed
          {percent > 0 ? ` · ${percent}%` : null}
        </div>
        <div className="h-2 w-full rounded bg-ui-bg-subtle">
          <div className="h-2 rounded bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 text-xs text-ui-fg-subtle">
          {money(backing_summary.pre_order_backed_amount)} from pre-orders
          {Number(backing_summary.investor_backed_amount ?? 0) > 0
            ? ` · ${money(backing_summary.investor_backed_amount)} from revenue-share backers`
            : null}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-medium">Where the money goes</h2>
        <p className="mb-3 max-w-3xl text-sm text-ui-fg-subtle">
          Every campaign publishes this split before anyone backs it.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <tbody>
              {allocation.map((row) => (
                <tr key={row.label} className="border-b border-ui-border-base">
                  <td className="py-2 pr-4">
                    {row.label}
                    {row.note ? (
                      <div className="text-xs text-ui-fg-subtle">{row.note}</div>
                    ) : null}
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(row.value)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-2 pr-4 font-medium">Campaign goal</td>
                <td className="py-2 text-right font-medium tabular-nums">{money(goal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {material_line_items.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-medium">Materials this campaign buys</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ui-border-base text-left text-xs uppercase text-ui-fg-subtle">
                  <th className="py-2 pr-4 font-normal">Item</th>
                  <th className="py-2 pr-4 font-normal">Supplier</th>
                  <th className="py-2 pr-4 text-right font-normal">Qty</th>
                  <th className="py-2 text-right font-normal">Cost</th>
                </tr>
              </thead>
              <tbody>
                {material_line_items.map((item) => (
                  <tr key={item.id} className="border-b border-ui-border-base">
                    <td className="py-2 pr-4">{item.description || "—"}</td>
                    <td className="py-2 pr-4">{item.supplier_name || "Not yet sourced"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{item.quantity ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{money(item.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4 text-sm">
        <h2 className="mb-2 font-medium">How to back this campaign</h2>
        <p className="mb-2 text-ui-fg-subtle">
          Backing is not open on this page yet. Pre-ordering a campaign moves
          money into escrow, and that flow is still being finished — this page
          exists so the campaign, its costs and its suppliers are visible
          before it does, rather than after.
        </p>
        <p className="text-ui-fg-subtle">
          The other way to back a campaign — a capped share of what the run
          earns, instead of finished units — is <strong>not offered</strong>,
          here or anywhere on this site. It needs a securities review first.
        </p>
      </section>
    </main>
  )
}

/**
 * A coalition shared goal: milestones and per-organisation progress instead of
 * the materials table. No "Production Campaign" copy — nothing here is
 * produced — and no backing call to action: contributions are direct charges on
 * each organisation's own account, and this page only reports the totals the
 * processor confirmed.
 */
function SharedGoalPage({
  progress,
  report,
}: {
  progress: CampaignProgress
  report: CampaignImpactReport | null
}) {
  const { campaign, milestones, participants } = progress
  const percent = campaign.percent_complete
  const impactSummary = report?.impact_summary ?? null
  const reachedCount = milestones.filter((m) => m.reached_at).length

  return (
    <main className="container py-10">
      <LocalizedClientLink
        href="/collective/campaigns"
        className="mb-4 inline-block text-sm underline"
      >
        ← All campaigns
      </LocalizedClientLink>

      <div className="mb-1 text-xs uppercase text-ui-fg-subtle">Shared goal · {campaign.status}</div>
      <h1 className="mb-3 text-2xl font-semibold">{campaign.name}</h1>
      <p className="mb-6 max-w-3xl text-sm text-ui-fg-subtle">{campaign.description}</p>

      <section className="mb-8 max-w-xl">
        <div className="mb-1 text-sm">
          <strong>{cents(campaign.contributed_total_cents)}</strong> of {cents(campaign.goal_amount_cents)} contributed
          {percent > 0 ? ` · ${percent}%` : null}
        </div>
        <div className="h-2 w-full rounded bg-ui-bg-subtle">
          <div className="h-2 rounded bg-primary" style={{ width: `${percent}%` }} />
        </div>
        {milestones.length > 0 ? (
          <div className="mt-2 text-xs text-ui-fg-subtle">
            {reachedCount} of {milestones.length} milestones reached
          </div>
        ) : null}
      </section>

      {milestones.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-medium">Milestones</h2>
          <ol className="space-y-2 text-sm">
            {milestones.map((milestone) => (
              <li key={milestone.id} className="rounded-md border border-ui-border-base p-3">
                <div className="flex items-baseline justify-between gap-4">
                  <span className={milestone.reached_at ? "font-medium" : undefined}>
                    {milestone.reached_at ? "✓ " : null}
                    {milestone.title}
                  </span>
                  <span className="tabular-nums text-ui-fg-subtle">{cents(milestone.target_amount_cents)}</span>
                </div>
                {milestone.reached_at && milestone.impact_summary ? (
                  <p className="mt-1 text-xs text-ui-fg-subtle">{milestone.impact_summary}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-medium">Progress by organisation</h2>
        <p className="mb-3 max-w-3xl text-sm text-ui-fg-subtle">
          Each organisation receives its contributions directly, on its own
          account. These are the totals the payment processor has confirmed.
        </p>
        {participants.length === 0 ? (
          <div className="rounded-md border p-4 text-sm text-ui-fg-subtle">No participating organisations yet.</div>
        ) : (
          <ul className="space-y-3">
            {participants.map((participant) => {
              const share =
                campaign.goal_amount_cents > 0
                  ? Math.min(100, Math.round((participant.contributed_amount_cents / campaign.goal_amount_cents) * 100))
                  : 0
              return (
                <li key={participant.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-4 text-sm">
                    <span>
                      {participant.partner_org_key ?? participant.seller_id ?? "Organisation"}
                      <span className="ml-2 text-xs uppercase text-ui-fg-subtle">
                        {ROLE_LABELS[participant.role] ?? participant.role}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {cents(participant.contributed_amount_cents)}
                      {participant.pledged_amount_cents > 0 ? (
                        <span className="text-ui-fg-subtle"> of {cents(participant.pledged_amount_cents)} pledged</span>
                      ) : null}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded bg-ui-bg-subtle">
                    <div className="h-2 rounded bg-primary" style={{ width: `${share}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {impactSummary || (report && report.reached_milestones.length > 0) ? (
        <section className="mb-8 rounded-md border border-ui-border-base bg-ui-bg-subtle p-4 text-sm">
          <h2 className="mb-2 font-medium">Joint impact report</h2>
          {impactSummary ? <p className="mb-2">{impactSummary}</p> : null}
          {report && report.reached_milestones.length > 0 ? (
            <ul className="list-disc pl-5 text-ui-fg-subtle">
              {report.reached_milestones.map((m) => (
                <li key={m.id}>
                  {m.title}
                  {m.impact_summary ? ` — ${m.impact_summary}` : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
