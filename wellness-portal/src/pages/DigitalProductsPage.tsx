import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { useDigitalProducts } from "@/hooks/useWellness"
import { money, classNames } from "@bmc/portal-kit"

const TYPE_LABEL: Record<string, string> = {
  single: "Single file",
  course: "Course",
  bundle: "Bundle",
  deck: "Affirmation deck",
}

export function DigitalProductsPage() {
  const { data, isLoading, isError } = useDigitalProducts()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Digital Products"
        subtitle="Guided audio, PDFs, courses — instant download after purchase."
        action={<button className="btn-primary text-sm">New digital product</button>}
      />
      <QueryState isLoading={isLoading} isError={isError}>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data?.map((p) => (
            <div key={p.id} className="panel-pad space-y-2">
              <div className="flex items-start justify-between">
                <div className="text-cream-50 font-medium">{p.name}</div>
                <span
                  className={classNames(
                    "text-[10px] rounded-full px-2 py-0.5",
                    p.status === "public" ? "bg-forest-900/40 text-forest-300" : "bg-moss text-ghost"
                  )}
                >
                  {p.status}
                </span>
              </div>
              <div className="text-xs text-mist">{TYPE_LABEL[p.type]}</div>
              <div className="flex items-center justify-between pt-1 text-sm">
                <span className="text-cream-100">{p.price_amount ? money(p.price_amount) : "Free"}</span>
                <span className="text-xs text-ghost">
                  {p.total_sales} sold · {p.download_count} downloads
                </span>
              </div>
              <div className="flex gap-2 pt-1">
                <button className="btn-ghost text-xs">Edit</button>
                <button className="btn-ghost text-xs">View buyers</button>
              </div>
            </div>
          ))}
        </div>
      </QueryState>

      <div className="panel-pad text-sm text-mist">
        <div className="heading text-sm text-cream-50 mb-1">Delivery</div>
        Recent purchases deliver instantly via download link or encrypted Blackout DM. Use
        “View buyers” on a product to resend a download link.
      </div>
    </div>
  )
}
