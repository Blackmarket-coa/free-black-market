import type { Metadata } from "next"
import { notFound } from "next/navigation"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { getCampaign } from "@/lib/data/collective"

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  try {
    const dashboard = await getCampaign(id)
    return {
      title: `${dashboard.campaign.name} — Production Campaign`,
      description: dashboard.campaign.description?.slice(0, 200),
    }
  } catch {
    return { title: "Production Campaign" }
  }
}

const money = (value: number | string | null | undefined) => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"
}

export default async function CampaignPage({ params }: Params) {
  const { id } = await params

  let dashboard
  try {
    dashboard = await getCampaign(id)
  } catch {
    notFound()
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
