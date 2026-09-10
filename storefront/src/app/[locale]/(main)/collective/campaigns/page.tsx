import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { listCampaigns, type Campaign } from "@/lib/data/collective"

export const metadata: Metadata = {
  title: "Production Campaigns",
  description:
    "Back a production run: campaign funds buy materials direct from suppliers, and every campaign shows where the money goes before you commit.",
}

/** Statuses a member can meaningfully browse. DRAFT is the vendor's own. */
const PUBLIC_STATUSES = new Set([
  "ACTIVE",
  "FUNDED",
  "SOURCING",
  "MATERIALS_RECEIVED",
  "PRODUCING",
  "FULFILLING",
  "SELLING",
  "COMPLETE",
])

const money = (value: number | string | null | undefined) => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"
}

const fundedPercent = (campaign: Campaign) => {
  const goal = Number(campaign.campaign_goal ?? 0)
  if (!goal) return 0
  return Math.min(100, Math.round((Number(campaign.total_backed_amount ?? 0) / goal) * 100))
}

export default async function CampaignsPage() {
  const all = await listCampaigns({ limit: 50 })
  const campaigns = all.filter((c) => PUBLIC_STATUSES.has(c.status))

  return (
    <main className="container py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Production Campaigns</h1>
        <p className="mt-1 max-w-3xl text-sm text-ui-fg-subtle">
          A campaign funds one production run. Money raised buys the materials
          listed on the campaign, paid direct to suppliers — it never passes
          through the maker&apos;s hands. The maker is paid a stated fee,
          released against milestones as the run progresses.
        </p>
      </div>

      <div className="mb-8 rounded-md border border-ui-border-base bg-ui-bg-subtle p-4 text-sm">
        <strong className="font-medium">Pre-orders only, for now.</strong>{" "}
        Backing a campaign here means pre-ordering finished units — you are
        buying a thing. Campaigns can also be structured to offer a capped
        share of revenue instead, and that is not open: it needs a securities
        review first, and nothing on this site offers it until that review
        clears.
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
          No open production campaigns yet.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {campaigns.map((campaign) => {
            const percent = fundedPercent(campaign)

            return (
              <div key={campaign.id} className="rounded-md border p-4">
                <div className="mb-1 text-xs uppercase text-ui-fg-subtle">
                  {campaign.campaign_type} · {campaign.status}
                </div>
                <h2 className="mb-2 text-lg font-medium">{campaign.name}</h2>
                <p className="mb-3 line-clamp-3 text-sm text-ui-fg-subtle">
                  {campaign.description}
                </p>

                <div className="mb-1 text-xs text-ui-fg-subtle">
                  {money(campaign.total_backed_amount)} of {money(campaign.campaign_goal)} backed
                  {percent > 0 ? ` · ${percent}%` : null}
                </div>
                <div className="h-2 w-full rounded bg-ui-bg-subtle">
                  <div className="h-2 rounded bg-primary" style={{ width: `${percent}%` }} />
                </div>

                <div className="mt-4">
                  <LocalizedClientLink
                    href={`/collective/campaigns/${campaign.id}`}
                    className="text-sm underline"
                  >
                    See where the money goes
                  </LocalizedClientLink>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
