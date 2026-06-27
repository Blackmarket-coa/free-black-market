import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { useAnalytics } from "@/hooks/useCreatorData"
import { credits, money } from "@/lib/format"

const AXIS = { stroke: "#5a6b52", fontSize: 11 }
const GRID = "#242b14"

export function AnalyticsPage() {
  const { data, isLoading, isError } = useAnalytics()

  return (
    <div className="space-y-5">
      <PageHeader title="Analytics" subtitle="Revenue, MRR, member growth, and where your credits come from." />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <section className="panel-pad">
                <div className="heading text-sm text-cream-50 mb-3">MRR trend</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.mrr_trend}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                    <XAxis dataKey="month" {...AXIS} />
                    <YAxis {...AXIS} tickFormatter={(v) => `$${Math.round(v / 100000)}k`} />
                    <Tooltip formatter={(v: number) => money(v)} contentStyle={{ background: "#1a1f0f", border: "1px solid #242b14" }} />
                    <Line type="monotone" dataKey="mrr_cents" stroke="#f5b432" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </section>

              <section className="panel-pad">
                <div className="heading text-sm text-cream-50 mb-3">Member growth</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.members_growth}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                    <XAxis dataKey="month" {...AXIS} />
                    <YAxis {...AXIS} />
                    <Tooltip contentStyle={{ background: "#1a1f0f", border: "1px solid #242b14" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="new_members" name="New" fill="#34a362" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="churned_members" name="Churned" fill="#C4622D" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </section>

              <section className="panel-pad">
                <div className="heading text-sm text-cream-50 mb-3">Credits flow</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.credits_flow}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                    <XAxis dataKey="week" {...AXIS} />
                    <YAxis {...AXIS} />
                    <Tooltip formatter={(v: number) => credits(v)} contentStyle={{ background: "#1a1f0f", border: "1px solid #242b14" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="tips_credits" name="Tips" fill="#f5b432" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="boosts_credits" name="Boosts" fill="#34a362" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </section>

              <section className="panel-pad">
                <div className="heading text-sm text-cream-50 mb-3">Top supporters</div>
                <div className="space-y-2">
                  {data.top_supporters.map((s) => (
                    <div key={s.name} className="flex items-center justify-between text-sm">
                      <span className="text-cream-100">{s.name}</span>
                      <span className="text-amber-300">{credits(s.credits)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="panel-pad">
              <div className="heading text-sm text-cream-50 mb-2">Insights</div>
              <ul className="space-y-1 text-sm text-mist list-disc list-inside">
                {data.insights.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </section>
          </>
        )}
      </QueryState>
    </div>
  )
}
