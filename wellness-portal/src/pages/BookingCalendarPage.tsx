import { useMemo, useState } from "react"
import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { useClasses, useDashboard } from "@/hooks/useWellness"
import { classNames } from "@bmc/portal-kit"

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const HOURS = Array.from({ length: 11 }, (_, i) => 9 + i) // 9am–7pm

type CalItem = {
  day: number // 0-6
  hour: number
  label: string
  kind: "session" | "class"
  status: string
}

// Start-of-week (Sunday) for the week containing `base`.
function weekStart(base: Date) {
  const d = new Date(base)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

export function BookingCalendarPage() {
  const { data: dash, isLoading, isError } = useDashboard()
  const { data: classes } = useClasses()
  const [showAvailability, setShowAvailability] = useState(false)

  const items = useMemo<CalItem[]>(() => {
    const out: CalItem[] = []
    for (const b of dash?.todays_agenda ?? []) {
      const dt = new Date(b.starts_at)
      out.push({
        day: dt.getDay(),
        hour: dt.getHours(),
        label: `${b.client_name} · ${b.session_type_name}`,
        kind: b.client_name === "Group Class" ? "class" : "session",
        status: b.status,
      })
    }
    for (const c of classes ?? []) {
      const dt = new Date(c.starts_at)
      out.push({ day: dt.getDay(), hour: dt.getHours(), label: c.title, kind: "class", status: c.status })
    }
    return out
  }, [dash, classes])

  const start = weekStart(new Date("2026-06-27T12:00:00Z"))

  function itemAt(day: number, hour: number) {
    return items.find((i) => i.day === day && i.hour === hour)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Booking Calendar"
        subtitle="Your week of sessions and classes."
        action={
          <button onClick={() => setShowAvailability((s) => !s)} className="btn-ghost text-sm">
            {showAvailability ? "Hide availability" : "Availability settings"}
          </button>
        }
      />

      <div className="flex gap-3 text-xs text-mist">
        <Legend color="bg-forest-600" label="Confirmed session" />
        <Legend color="bg-amber-500" label="Pending" />
        <Legend color="bg-clay" label="Group class" />
      </div>

      {showAvailability && (
        <div className="panel-pad text-sm text-mist space-y-2">
          <div className="heading text-sm text-cream-50">Availability template</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {DAYS.map((d) => (
              <label key={d} className="flex items-center gap-2">
                <input type="checkbox" defaultChecked={d !== "Sun" && d !== "Sat"} /> {d}
              </label>
            ))}
          </div>
          <div className="text-xs text-ghost">
            Hours 9:00–19:00 · 15-min buffer · 24h notice · 60-day horizon (demo values)
          </div>
        </div>
      )}

      <QueryState isLoading={isLoading} isError={isError}>
        <div className="panel overflow-x-auto scroll-area">
          <div className="min-w-[720px]">
            {/* header row */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-moss">
              <div className="px-2 py-2 text-xs text-ghost" />
              {DAYS.map((d, i) => {
                const date = new Date(start)
                date.setDate(start.getDate() + i)
                return (
                  <div key={d} className="px-2 py-2 text-center text-xs text-mist border-l border-moss/50">
                    {d} {date.getDate()}
                  </div>
                )
              })}
            </div>
            {/* time rows */}
            {HOURS.map((h) => (
              <div key={h} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-moss/40">
                <div className="px-2 py-3 text-xs text-ghost">{h}:00</div>
                {DAYS.map((_, day) => {
                  const it = itemAt(day, h)
                  return (
                    <div key={day} className="border-l border-moss/40 p-1 min-h-[44px]">
                      {it && (
                        <div
                          className={classNames(
                            "rounded-xs px-1.5 py-1 text-[11px] text-white truncate",
                            it.kind === "class"
                              ? "bg-clay"
                              : it.status === "pending"
                              ? "bg-amber-500"
                              : "bg-forest-600"
                          )}
                          title={it.label}
                        >
                          {it.label}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </QueryState>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={classNames("w-3 h-3 rounded-xs", color)} />
      {label}
    </span>
  )
}
