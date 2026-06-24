import { Container, Heading, Select, Text } from "@medusajs/ui"
import { useState } from "react"
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
import { useEmbedAnalytics } from "../../hooks/api/embed-analytics"

const Stat = ({ label, value }: { label: string; value: number | string }) => (
  <div className="border-ui-border-base bg-ui-bg-subtle flex flex-col gap-1 rounded-lg border p-4">
    <Text size="xsmall" className="text-ui-fg-muted">
      {label}
    </Text>
    <Text className="text-ui-fg-base text-2xl font-semibold">{value}</Text>
  </div>
)

export const EmbedAnalytics = () => {
  const [range, setRange] = useState(30)
  const { analytics, isPending } = useEmbedAnalytics(range)

  const funnel = analytics?.funnel
  const conv =
    funnel && funnel.views > 0
      ? Math.round((funnel.orders / funnel.views) * 1000) / 10
      : 0

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Embed Analytics</Heading>
          <Text className="text-ui-fg-subtle mt-1" size="small">
            How your connect.js embed performs across the sites you've placed it
            on.
          </Text>
        </div>
        <div className="w-40">
          <Select value={String(range)} onValueChange={(v) => setRange(Number(v))}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="7">Last 7 days</Select.Item>
              <Select.Item value="30">Last 30 days</Select.Item>
              <Select.Item value="90">Last 90 days</Select.Item>
            </Select.Content>
          </Select>
        </div>
      </div>

      {isPending || !analytics ? (
        <div className="px-6 py-10">
          <Text className="text-ui-fg-subtle" size="small">
            Loading…
          </Text>
        </div>
      ) : (
        <div className="flex flex-col gap-y-8 px-6 pb-6">
          {/* Funnel summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Views" value={funnel?.views ?? 0} />
            <Stat label="Add to cart" value={funnel?.add_to_cart ?? 0} />
            <Stat label="Checkout" value={funnel?.checkout_start ?? 0} />
            <Stat label="Orders" value={funnel?.orders ?? 0} />
            <Stat label="Conversion" value={`${conv}%`} />
          </div>

          {/* Daily views & orders */}
          <div>
            <Heading level="h2" className="mb-3">
              Daily activity
            </Heading>
            {analytics.by_day.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={analytics.by_day}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="views" stroke="#6366f1" name="Views" />
                  <Line type="monotone" dataKey="orders" stroke="#16a34a" name="Orders" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Text size="small" className="text-ui-fg-muted">
                No activity in this range yet.
              </Text>
            )}
          </div>

          {/* Traffic by domain */}
          <div>
            <Heading level="h2" className="mb-3">
              Traffic by domain
            </Heading>
            {analytics.by_origin.length ? (
              <ResponsiveContainer width="100%" height={Math.max(120, analytics.by_origin.length * 36)}>
                <BarChart data={analytics.by_origin} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" fontSize={11} allowDecimals={false} />
                  <YAxis type="category" dataKey="origin" width={160} fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#6366f1" name="Events" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Text size="small" className="text-ui-fg-muted">
                No domain data yet. Add a publishable key to your embed to start
                collecting analytics.
              </Text>
            )}
          </div>

          {/* Top products */}
          {analytics.top_products.length > 0 && (
            <div>
              <Heading level="h2" className="mb-3">
                Most-viewed products
              </Heading>
              <div className="border-ui-border-base divide-ui-border-base divide-y rounded-lg border">
                {analytics.top_products.map((p) => (
                  <div key={p.product_id} className="flex items-center justify-between p-3">
                    <code className="text-ui-fg-subtle text-xs">{p.product_id}</code>
                    <Text size="small">{p.views} views</Text>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Container>
  )
}

export const Component = EmbedAnalytics
