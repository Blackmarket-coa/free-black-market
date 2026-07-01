import { Link } from "react-router-dom"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { UrgentBanner } from "@/components/ui/UrgentBanner"
import { EmptyState } from "@bmc/ui"
import { useDashboard } from "@/hooks/useWellness"
import { money, shortDate, classNames } from "@bmc/portal-kit"
import type { BookingStatus } from "@/types"

const STATUS_COLOR: Record<BookingStatus, string> = {
  confirmed: "text-forest-300",
  pending: "text-amber-300",
  completed: "text-mist",
  cancelled: "text-ghost",
  no_show: "text-clay",
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

export function DashboardPage() {
  const { data, isLoading, isError } = useDashboard()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Your day at a glance — sessions, urgent actions, and revenue."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <>
            {/* Today's agenda */}
            <section>
              <h2 className="heading text-sm mb-2">Today's agenda</h2>
              {data.todays_agenda.length === 0 ? (
                <EmptyState
                  icon="🌿"
                  title="No sessions today"
                  message="Create availability or promote a class to fill your day."
                  cta={
                    <Link to="/calendar" className="btn-primary text-sm">
                      Open calendar
                    </Link>
                  }
                />
              ) : (
                <div className="panel divide-y divide-moss/50">
                  {data.todays_agenda.map((b) => (
                    <div key={b.id} className="flex items-center gap-3 p-3">
                      <div className="w-16 text-sm text-cream-100">{timeOf(b.starts_at)}</div>
                      <div className="flex-1">
                        <div className="text-sm text-cream-50">
                          {b.client_name} · {b.session_type_name}
                        </div>
                        <div className="text-xs text-mist">
                          {b.duration_minutes} min · {b.delivery === "virtual" ? "Virtual" : "In-person"}
                        </div>
                      </div>
                      <span className={classNames("text-xs capitalize", STATUS_COLOR[b.status])}>
                        {b.status.replace("_", " ")}
                      </span>
                      <Link to="/blackout" className="btn-ghost text-xs">
                        DM
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Urgent actions */}
            {data.urgent_actions.length > 0 && (
              <section className="space-y-2">
                <h2 className="heading text-sm">Needs attention</h2>
                {data.urgent_actions.map((a, i) => (
                  <UrgentBanner key={i} action={a} />
                ))}
              </section>
            )}

            {/* Revenue snapshot */}
            <section>
              <h2 className="heading text-sm mb-2">This month</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricCard label="Sessions" value={money(data.revenue.sessions_cents)} icon="🌿" />
                <MetricCard label="Classes" value={money(data.revenue.classes_cents)} icon="🎉" />
                <MetricCard label="Memberships" value={money(data.revenue.memberships_cents)} icon="💎" />
                <MetricCard
                  label="Total"
                  value={money(data.revenue.total_cents)}
                  icon="💸"
                  subtitle={`vs ${money(data.revenue.last_month_total_cents)} last month`}
                />
              </div>
            </section>

            {/* Week at a glance */}
            <section>
              <h2 className="heading text-sm mb-2">This week</h2>
              <div className="grid grid-cols-5 gap-2">
                {data.week.map((d) => (
                  <Link
                    key={d.date}
                    to="/calendar"
                    className="panel-pad text-center hover:border-amber-700 transition-colors"
                  >
                    <div className="text-xs text-ghost">{shortDate(d.date)}</div>
                    <div className="text-sm text-cream-50 mt-1">
                      {d.session_count + d.class_count} events
                    </div>
                    <div className="text-xs text-mist">{money(d.revenue_cents)}</div>
                  </Link>
                ))}
              </div>
            </section>

            {/* Next class + recent clients */}
            <div className="grid md:grid-cols-2 gap-6">
              {data.next_class && (
                <section>
                  <h2 className="heading text-sm mb-2">Next class</h2>
                  <div className="panel-pad">
                    <div className="text-cream-50">{data.next_class.title}</div>
                    <div className="text-xs text-mist mt-1">{shortDate(data.next_class.starts_at)}</div>
                    <div className="mt-2 text-sm text-amber-300">
                      {data.next_class.seats_taken}/{data.next_class.capacity} spots filled ·{" "}
                      {Math.max(0, data.next_class.capacity - data.next_class.seats_taken)} remaining
                    </div>
                    <Link to="/classes" className="btn-ghost text-xs mt-3 inline-flex">
                      Share / manage
                    </Link>
                  </div>
                </section>
              )}
              <section>
                <h2 className="heading text-sm mb-2">Recent clients</h2>
                <div className="panel divide-y divide-moss/50">
                  {data.recent_clients.map((c) => (
                    <div key={c.id} className="flex items-center justify-between p-3">
                      <div>
                        <div className="text-sm text-cream-50">{c.name}</div>
                        <div className="text-xs text-mist">{c.total_bookings} sessions</div>
                      </div>
                      <Link to="/clients" className="btn-ghost text-xs">
                        View
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </QueryState>
    </div>
  )
}
