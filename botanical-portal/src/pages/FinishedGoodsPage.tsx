import { useActivePathways } from "@/hooks/useActivePathways"
import { useFinishedGoods } from "@/hooks/useFinishedGoods"
import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { EmptyState } from "@/components/ui/EmptyState"
import { iconForOutput } from "@/lib/pathways"
import { money, shortDate, daysUntil, classNames } from "@bmc/portal-kit"
import type { FinishedGood, ProductionPathway } from "@/types"

const STATUS_STYLE: Record<FinishedGood["status"], string> = {
  available: "text-forest-300",
  reserved: "text-amber-300",
  shipped: "text-mist",
  quarantine: "text-clay",
  expired: "text-clay",
}

export function FinishedGoodsPage() {
  const { data: goods = [], isLoading, isError } = useFinishedGoods()
  const { data: pathways = [] } = useActivePathways()

  const pathwayById = (id: string): ProductionPathway | undefined =>
    pathways.find((p) => p.id === id)

  return (
    <div>
      <PageHeader
        title="Finished Goods"
        subtitle="Batch-traceable inventory. Expiry or seed viability is tracked per pathway."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {goods.length === 0 ? (
          <EmptyState icon="🫙" title="No finished goods" />
        ) : (
          <div className="panel overflow-x-auto scroll-area">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ghost border-b border-moss">
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Batch</th>
                  <th className="px-3 py-2 font-medium">On hand</th>
                  <th className="px-3 py-2 font-medium">Expiry / Viability</th>
                  <th className="px-3 py-2 font-medium">Retail</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {goods.map((g) => {
                  const pathway = pathwayById(g.pathway_id)
                  return (
                    <tr key={g.id} className="border-b border-moss/50 hover:bg-moss/30">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span>{iconForOutput(g.output_category)}</span>
                          <div className="min-w-0">
                            <div className="text-cream-100 truncate">{g.product_name}</div>
                            <div
                              className="text-[11px] text-ghost"
                              title={pathway?.shelf_life_note}
                            >
                              {g.sku}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-mist">
                        {g.batch_number}
                      </td>
                      <td className="px-3 py-2 text-cream-100">
                        {g.quantity_on_hand} × {g.unit_size}
                      </td>
                      <td className="px-3 py-2">
                        <ExpiryOrViability good={g} />
                      </td>
                      <td className="px-3 py-2 text-cream-100">{money(g.retail_price_cents)}</td>
                      <td className="px-3 py-2">
                        <span className={classNames("text-xs", STATUS_STYLE[g.status])}>
                          {g.status}
                        </span>
                        {!g.label_approved && (
                          <div className="text-[11px] text-amber-300">label review</div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </div>
  )
}

// The single smart cell: seed pathway shows germination rate; craft/dye shows
// expiry only if one is set; everything else shows color-coded expiry.
function ExpiryOrViability({ good }: { good: FinishedGood }) {
  if (good.output_category === "seed_packet") {
    if (good.germination_rate == null) return <span className="text-ghost">—</span>
    const stale =
      good.germination_rate < 70 ||
      (good.germination_test_date && (daysUntil(good.germination_test_date) ?? 0) < -365)
    return (
      <div>
        <span className={stale ? "text-clay" : "text-forest-300"}>
          {good.germination_rate}% germ.
        </span>
        <div className="text-[11px] text-ghost">
          tested {shortDate(good.germination_test_date)}
        </div>
        {stale && <div className="text-[11px] text-clay">retest needed</div>}
      </div>
    )
  }

  if (good.output_category === "craft_fiber_dye" && !good.expiry_date) {
    return <span className="text-ghost">no expiry</span>
  }

  if (!good.expiry_date) return <span className="text-ghost">—</span>

  const days = daysUntil(good.expiry_date)
  const tone =
    days == null
      ? "text-mist"
      : days < 0
      ? "text-clay"
      : days <= 30
      ? "text-amber-300"
      : "text-cream-100"
  return (
    <div>
      <span className={tone}>{shortDate(good.expiry_date)}</span>
      {days != null && days >= 0 && days <= 30 && (
        <div className="text-[11px] text-amber-300">{days}d left</div>
      )}
      {days != null && days < 0 && <div className="text-[11px] text-clay">expired</div>}
    </div>
  )
}
