import { useState } from "react"
import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { useSessionTypes } from "@/hooks/useWellness"
import { money, classNames } from "@bmc/portal-kit"

export function SessionsPage() {
  const { data, isLoading, isError } = useSessionTypes()
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sessions"
        subtitle="Your 1:1 service menu. Each session type becomes a bookable FBM listing."
        action={
          <button onClick={() => setShowForm((s) => !s)} className="btn-primary text-sm">
            {showForm ? "Close" : "New session type"}
          </button>
        }
      />

      {showForm && (
        <div className="panel-pad space-y-3">
          <div className="heading text-sm text-cream-50">Create session type</div>
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <Field label="Name" placeholder="60-Minute Reiki Session" />
            <Field label="Price (USD)" placeholder="120" />
            <Field label="Duration (min)" placeholder="60" />
            <Field label="Buffer (min)" placeholder="15" />
            <div>
              <label className="block text-xs text-ghost mb-1">Modality</label>
              <select className="w-full bg-soil border border-moss rounded-sm px-3 py-1.5 text-cream-100">
                <option>Reiki</option>
                <option>Energy Work</option>
                <option>Sound Healing</option>
                <option>Coaching</option>
                <option>Breathwork</option>
                <option>Reading</option>
                <option>Astrology</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-ghost mb-1">Delivery</label>
              <select className="w-full bg-soil border border-moss rounded-sm px-3 py-1.5 text-cream-100">
                <option>Virtual</option>
                <option>In-person</option>
                <option>Either</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-sm">Create & list on FBM</button>
            <button onClick={() => setShowForm(false)} className="btn-ghost text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      <QueryState isLoading={isLoading} isError={isError}>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data?.map((s) => (
            <div key={s.id} className="panel-pad space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-cream-50 font-medium">{s.name}</div>
                <span
                  className={classNames(
                    "text-[10px] rounded-full px-2 py-0.5",
                    s.is_active ? "bg-forest-900/40 text-forest-300" : "bg-moss text-ghost"
                  )}
                >
                  {s.is_active ? "Visible" : "Hidden"}
                </span>
              </div>
              <p className="text-xs text-mist line-clamp-2">{s.description}</p>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <Tag>{s.duration_minutes} min</Tag>
                {s.modality && <Tag>{s.modality}</Tag>}
                <Tag>{s.location_type}</Tag>
                {s.is_embeddable && <Tag>embed</Tag>}
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm text-cream-100">
                  {s.price_amount ? money(s.price_amount) : "Free"}
                </span>
                <span className="text-xs text-ghost">{s.bookings_this_month ?? 0} this mo</span>
              </div>
              <div className="flex gap-2 pt-1">
                <button className="btn-ghost text-xs">Edit</button>
                <button className="btn-ghost text-xs">Duplicate</button>
              </div>
            </div>
          ))}
        </div>
      </QueryState>
    </div>
  )
}

function Field({ label, placeholder }: { label: string; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-ghost mb-1">{label}</label>
      <input
        placeholder={placeholder}
        className="w-full bg-soil border border-moss rounded-sm px-3 py-1.5 text-cream-100 placeholder:text-ghost focus:outline-none focus:border-amber-600"
      />
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-moss/60 px-2 py-0.5 text-mist">{children}</span>
}
