import { Container, Heading, Select, Text } from "@medusajs/ui"
import { useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  useCreatorAnalytics,
  useProductAnalytics,
} from "../../hooks/api/analytics"

const Stat = ({ label, value }: { label: string; value: number | string }) => (
  <div className="border-ui-border-base bg-ui-bg-subtle flex flex-col gap-1 rounded-lg border p-4">
    <Text size="xsmall" className="text-ui-fg-muted">
      {label}
    </Text>
    <Text className="text-ui-fg-base text-2xl font-semibold">{value}</Text>
  </div>
)

const formatPercent = (fraction: number | null) =>
  fraction === null ? "—" : `${Math.round(fraction * 1000) / 10}%`

const formatCents = (cents: number) =>
  (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  })

/**
 * Performance (Phase 4A): storefront conversion funnel for the seller's
 * products + creator performance, read from the analytics_event pipeline.
 */
export const Performance = () => {
  const [range, setRange] = useState(30)
  const { analytics: products, isPending: productsPending } =
    useProductAnalytics(range)
  const { analytics: creator } = useCreatorAnalytics(range)

  const funnel = products?.funnel
  const hasCreatorActivity =
    !!creator &&
    (creator.totals.profile_views > 0 ||
      creator.totals.link_clicks > 0 ||
      creator.totals.affiliate_clicks > 0 ||
      creator.totals.attributed_orders > 0)

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Performance</Heading>
          <Text className="text-ui-fg-subtle mt-1" size="small">
            How shoppers move from viewing your products to ordering them.
          </Text>
        </div>
        <div className="w-40">
          <Select
            value={String(range)}
            onValueChange={(v) => setRange(Number(v))}
          >
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

      {productsPending || !products ? (
        <div className="px-6 py-10">
          <Text className="text-ui-fg-subtle" size="small">
            Loading…
          </Text>
        </div>
      ) : (
        <div className="flex flex-col gap-y-8 px-6 pb-6">
          {/* Funnel summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Product views" value={funnel?.views ?? 0} />
            <Stat label="Add to cart" value={funnel?.add_to_carts ?? 0} />
            <Stat label="Orders" value={funnel?.orders ?? 0} />
            <Stat label="Units sold" value={funnel?.units ?? 0} />
            <Stat
              label="Conversion"
              value={formatPercent(funnel?.conversion ?? null)}
            />
          </div>

          {/* Daily views & add-to-carts */}
          <div>
            <Heading level="h2" className="mb-3">
              Daily activity
            </Heading>
            {products.by_day.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={products.by_day}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="views"
                    stroke="#6366f1"
                    name="Views"
                  />
                  <Line
                    type="monotone"
                    dataKey="add_to_carts"
                    stroke="#16a34a"
                    name="Add to cart"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Text size="small" className="text-ui-fg-muted">
                No activity in this range yet.
              </Text>
            )}
          </div>

          {/* Per-product conversion */}
          <div>
            <Heading level="h2" className="mb-3">
              Products
            </Heading>
            {products.by_product.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ui-fg-subtle border-b text-left">
                    <th className="py-2">Product</th>
                    <th className="py-2 text-right">Views</th>
                    <th className="py-2 text-right">Add to cart</th>
                    <th className="py-2 text-right">Orders</th>
                    <th className="py-2 text-right">Units</th>
                    <th className="py-2 text-right">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {products.by_product.map((row) => (
                    <tr key={row.product_id} className="border-b">
                      <td className="py-2">
                        {row.title ?? (
                          <span className="font-mono text-xs">
                            {row.product_id}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">{row.views}</td>
                      <td className="py-2 text-right">{row.add_to_carts}</td>
                      <td className="py-2 text-right">{row.orders}</td>
                      <td className="py-2 text-right">{row.units}</td>
                      <td className="py-2 text-right">
                        {formatPercent(row.conversion)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Text size="small" className="text-ui-fg-muted">
                No product activity in this range yet.
              </Text>
            )}
          </div>

          {/* Creator performance — only when there is creator activity */}
          {hasCreatorActivity && creator && (
            <div className="flex flex-col gap-y-4">
              <div>
                <Heading level="h2">Creator performance</Heading>
                <Text className="text-ui-fg-subtle" size="small">
                  Profile views, link clicks, and orders attributed to your
                  creator links.
                </Text>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat
                  label="Profile views"
                  value={creator.totals.profile_views}
                />
                <Stat label="Link clicks" value={creator.totals.link_clicks} />
                <Stat
                  label="Affiliate clicks"
                  value={creator.totals.affiliate_clicks}
                />
                <Stat
                  label="Attributed orders"
                  value={creator.totals.attributed_orders}
                />
                <Stat
                  label="Commission"
                  value={formatCents(creator.totals.commission_cents)}
                />
              </div>
              {creator.by_campaign.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-ui-fg-subtle border-b text-left">
                      <th className="py-2">Campaign</th>
                      <th className="py-2 text-right">Events</th>
                      <th className="py-2 text-right">Link clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creator.by_campaign.map((row) => (
                      <tr key={row.campaign} className="border-b">
                        <td className="py-2">{row.campaign}</td>
                        <td className="py-2 text-right">{row.events}</td>
                        <td className="py-2 text-right">{row.link_clicks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </Container>
  )
}
