import {
  Area,
  AreaChart,
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
import { useAnalytics } from "@/hooks/useWellness"

const AXIS = { stroke: "#8c8270", fontSize: 11 }
const GRID = "#242b14"
const WARM = ["#E8C547", "#C4622D", "#dc9b28", "#7EC850", "#268751"]

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel-pad">
      <div className="heading text-sm text-cream-50 mb-3">{title}</div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </div>
  )
}

export function AnalyticsPage() {
  const { data, isLoading, isError } = useAnalytics()

  return (
    <div className="space-y-5">
      <PageHeader title="Analytics" subtitle="How your wellness business is growing." />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div className="grid lg:grid-cols-2 gap-4">
              <ChartCard title="Revenue by product type">
                <AreaChart data={data.revenue_by_type}>
                  <CartesianGrid stroke={GRID} />
                  <XAxis dataKey="month" {...AXIS} />
                  <YAxis {...AXIS} />
                  <Tooltip contentStyle={{ background: "#1a1f0f", border: `1px solid ${GRID}` }} />
                  <Legend />
                  {["Sessions", "Classes", "Digital", "Physical", "Memberships"].map((k, i) => (
                    <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={WARM[i]} fill={WARM[i]} fillOpacity={0.5} />
                  ))}
                </AreaChart>
              </ChartCard>

              <ChartCard title="Booking rate (available vs booked hours)">
                <LineChart data={data.booking_rate}>
                  <CartesianGrid stroke={GRID} />
                  <XAxis dataKey="week" {...AXIS} />
                  <YAxis {...AXIS} />
                  <Tooltip contentStyle={{ background: "#1a1f0f", border: `1px solid ${GRID}` }} />
                  <Legend />
                  <Line type="monotone" dataKey="available_hours" stroke="#8c8270" />
                  <Line type="monotone" dataKey="booked_hours" stroke="#E8C547" strokeWidth={2} />
                </LineChart>
              </ChartCard>

              <ChartCard title="Client retention">
                <BarChart data={data.retention}>
                  <CartesianGrid stroke={GRID} />
                  <XAxis dataKey="month" {...AXIS} />
                  <YAxis {...AXIS} />
                  <Tooltip contentStyle={{ background: "#1a1f0f", border: `1px solid ${GRID}` }} />
                  <Legend />
                  <Bar dataKey="new_clients" fill="#C4622D" />
                  <Bar dataKey="returning_clients" fill="#E8C547" />
                </BarChart>
              </ChartCard>

              <ChartCard title="MRR growth">
                <LineChart data={data.mrr_trend}>
                  <CartesianGrid stroke={GRID} />
                  <XAxis dataKey="month" {...AXIS} />
                  <YAxis {...AXIS} />
                  <Tooltip contentStyle={{ background: "#1a1f0f", border: `1px solid ${GRID}` }} />
                  <Line type="monotone" dataKey="mrr_cents" stroke="#E8C547" strokeWidth={2} />
                </LineChart>
              </ChartCard>
            </div>

            <div className="panel-pad">
              <div className="heading text-sm text-cream-50 mb-2">Key insights</div>
              <ul className="space-y-1.5 text-sm text-mist list-disc list-inside">
                {data.insights.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </QueryState>
    </div>
  )
}
