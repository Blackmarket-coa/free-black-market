import { useEffect, useState } from "react"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { backendUrl, getAuthToken } from "../../lib/client"

interface RankedCreator {
  creator_seller_id: string
  score: number
  reasons: string[]
}
interface Coalition {
  id: string
  name: string
}
interface HighDemand {
  subject_key: string
  opportunity_score: number
}
interface Suggestions {
  recommended_creators: RankedCreator[]
  recommended_coalitions: Coalition[]
  high_demand_products: HighDemand[]
}

interface PriceTrend {
  direction: "rising" | "falling" | "flat"
  pctChange: number
}
interface TrendRow {
  category: string
  opportunity_score: number | null
  demand_direction: string
  price_trend: PriceTrend
}
interface TrendsResponse {
  trends: TrendRow[]
  rising_opportunities: HighDemand[]
}

async function authedFetch<T>(path: string): Promise<T> {
  const token = getAuthToken()
  const url = `${backendUrl.replace(/\/$/, "")}${path}`
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) {
    throw new Error(`${res.status}: ${res.statusText}`)
  }
  return (await res.json()) as T
}

const directionBadge = (d: string) => {
  if (d === "rising") return <Badge color="green">rising</Badge>
  if (d === "falling") return <Badge color="red">falling</Badge>
  return <Badge color="grey">steady</Badge>
}

export const GrowthPage = () => {
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null)
  const [trends, setTrends] = useState<TrendsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [s, t] = await Promise.all([
          authedFetch<Suggestions>("/v1/seller/growth/suggestions").catch(
            () => null
          ),
          authedFetch<TrendsResponse>(
            "/v1/seller/economic-intelligence/trends"
          ).catch(() => null),
        ])
        setSuggestions(s)
        setTrends(t)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Growth</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Recommended creators, coalitions, and high-demand opportunities —
          plus market trends to act on.
        </Text>
      </div>

      {loading && (
        <div className="px-6 py-4">
          <Text size="small">Loading…</Text>
        </div>
      )}
      {error && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-error">
            {error}
          </Text>
        </div>
      )}

      <div className="px-6 py-4">
        <Heading level="h2" className="mb-2">
          High-demand opportunities
        </Heading>
        {suggestions?.high_demand_products?.length ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.high_demand_products.map((h) => (
              <Badge key={h.subject_key} color="blue">
                {h.subject_key} · {h.opportunity_score.toFixed(1)}
              </Badge>
            ))}
          </div>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">
            No scored opportunities yet — they populate as demand builds.
          </Text>
        )}
      </div>

      <div className="px-6 py-4">
        <Heading level="h2" className="mb-2">
          Recommended creators
        </Heading>
        {suggestions?.recommended_creators?.length ? (
          <ul className="flex flex-col gap-2">
            {suggestions.recommended_creators.map((c) => (
              <li key={c.creator_seller_id} className="flex items-center gap-2">
                <Badge color="purple">{c.score.toFixed(2)}</Badge>
                <Text size="small">{c.creator_seller_id}</Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {c.reasons.join(" · ")}
                </Text>
              </li>
            ))}
          </ul>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">
            No creator matches yet.
          </Text>
        )}
      </div>

      <div className="px-6 py-4">
        <Heading level="h2" className="mb-2">
          Recommended coalitions
        </Heading>
        {suggestions?.recommended_coalitions?.length ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.recommended_coalitions.map((c) => (
              <Badge key={c.id} color="orange">
                {c.name}
              </Badge>
            ))}
          </div>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">
            No coalition suggestions yet.
          </Text>
        )}
      </div>

      <div className="px-6 py-4">
        <Heading level="h2" className="mb-2">
          Market trends
        </Heading>
        {trends?.trends?.length ? (
          <table className="w-full text-left">
            <thead>
              <tr className="text-ui-fg-subtle">
                <th className="py-1">Category</th>
                <th className="py-1">Demand</th>
                <th className="py-1">Price</th>
                <th className="py-1">Opportunity</th>
              </tr>
            </thead>
            <tbody>
              {trends.trends.map((t) => (
                <tr key={t.category} className="border-t">
                  <td className="py-1">{t.category}</td>
                  <td className="py-1">{directionBadge(t.demand_direction)}</td>
                  <td className="py-1">
                    {directionBadge(t.price_trend.direction)}{" "}
                    <Text size="small" className="text-ui-fg-subtle inline">
                      {t.price_trend.pctChange > 0 ? "+" : ""}
                      {t.price_trend.pctChange}%
                    </Text>
                  </td>
                  <td className="py-1">
                    {t.opportunity_score != null
                      ? t.opportunity_score.toFixed(1)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">
            Trends populate after the first opportunity recompute.
          </Text>
        )}
      </div>
    </Container>
  )
}
