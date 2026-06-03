import { useEffect, useState } from "react"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"
import { backendUrl, getAuthToken } from "../../lib/client"

interface RankedCreator {
  creator_seller_id: string
  score: number
  reasons: string[]
  follower_total: number
  niches: string[]
}

interface MatchingResponse {
  producer: { categories: string[]; region: string | null }
  creators: RankedCreator[]
}

interface LaunchResult {
  launch_id: string
  product_id: string
  cooperative_listing_id: string | null
  demand_post_id: string
  bounty_id: string | null
  program_id: string
  deal_id: string | null
  affiliate_link_id: string | null
  affiliate_short_code: string | null
  invited_creator_seller_id: string | null
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken()
  const url = `${backendUrl.replace(/\/$/, "")}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`${res.status}: ${body || res.statusText}`)
  }
  return (await res.json()) as T
}

export const FindCreatorsPage = () => {
  const [data, setData] = useState<MatchingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Inline "Launch with this creator" form state.
  const [launchFor, setLaunchFor] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [price, setPrice] = useState("")
  const [cooperativeId, setCooperativeId] = useState("")
  const [bountyAmount, setBountyAmount] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<LaunchResult | null>(null)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authedFetch<MatchingResponse>(
        "/v1/seller/matching/creators?limit=20"
      )
      setData(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const resetForm = () => {
    setLaunchFor(null)
    setTitle("")
    setPrice("")
    setCooperativeId("")
    setBountyAmount("")
    setResult(null)
  }

  const submitLaunch = async (creatorSellerId: string) => {
    if (!title.trim() || !price.trim()) {
      toast.error("Title and price are required")
      return
    }
    setSubmitting(true)
    try {
      const priceCents = Math.round(parseFloat(price) * 100)
      const body: Record<string, unknown> = {
        title: title.trim(),
        slug: slugify(title),
        price: Number.isFinite(priceCents) ? priceCents : 0,
        target_creator_seller_id: creatorSellerId,
      }
      if (cooperativeId.trim()) {
        body.cooperative_id = cooperativeId.trim()
      }
      if (bountyAmount.trim()) {
        body.bounty_amount = parseFloat(bountyAmount)
      }
      const res = await authedFetch<{ launch: LaunchResult }>(
        "/v1/seller/launches",
        { method: "POST", body: JSON.stringify(body) }
      )
      setResult(res.launch)
      toast.success("Launch created")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Find Creators</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Creators ranked for your store by niche, region, reach and track
            record. Launch a product with one in a single step.
          </Text>
        </div>
        <Button variant="secondary" onClick={reload} disabled={loading}>
          Refresh
        </Button>
      </div>

      {data ? (
        <div className="px-6 py-3">
          <Text size="small" className="text-ui-fg-subtle">
            Matching against{" "}
            {data.producer.categories.length
              ? data.producer.categories.join(", ")
              : "no product categories yet"}
            {data.producer.region ? ` · ${data.producer.region}` : ""}
          </Text>
        </div>
      ) : null}

      {loading ? (
        <div className="px-6 py-8">
          <Text className="text-ui-fg-subtle">Loading creators…</Text>
        </div>
      ) : error ? (
        <div className="px-6 py-8">
          <Text className="text-ui-fg-error">{error}</Text>
        </div>
      ) : !data || data.creators.length === 0 ? (
        <div className="px-6 py-8">
          <Text className="text-ui-fg-subtle">
            No creator candidates yet. Creators appear here once they apply to a
            program.
          </Text>
        </div>
      ) : (
        <ul className="divide-y">
          {data.creators.map((creator) => (
            <li key={creator.creator_seller_id} className="px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Text weight="plus" className="truncate">
                      {creator.creator_seller_id}
                    </Text>
                    <Badge size="2xsmall" color="green">
                      {Math.round(creator.score * 100)}% match
                    </Badge>
                  </div>
                  <Text size="small" className="text-ui-fg-subtle">
                    {creator.follower_total.toLocaleString()} reach
                    {creator.niches.length
                      ? ` · ${creator.niches.slice(0, 5).join(", ")}`
                      : ""}
                  </Text>
                  {creator.reasons.length ? (
                    <Text size="xsmall" className="text-ui-fg-muted mt-1">
                      {creator.reasons.join(" · ")}
                    </Text>
                  ) : null}
                </div>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => {
                    resetForm()
                    setLaunchFor(creator.creator_seller_id)
                  }}
                >
                  Launch &amp; invite this creator
                </Button>
              </div>

              {launchFor === creator.creator_seller_id ? (
                <div className="bg-ui-bg-subtle mt-4 rounded-lg p-4">
                  {result ? (
                    <div className="flex flex-col gap-1">
                      <Text weight="plus">Launch created 🎉</Text>
                      <Text size="small" className="text-ui-fg-subtle">
                        Product: {result.product_id}
                      </Text>
                      <Text size="small" className="text-ui-fg-subtle">
                        Bounty: {result.bounty_id ?? "—"} · Deal:{" "}
                        {result.deal_id ?? "—"}
                      </Text>
                      {result.deal_id ? (
                        <Text size="small" className="text-ui-fg-subtle">
                          Affiliate code: {result.affiliate_short_code ?? "—"}
                        </Text>
                      ) : (
                        <Text size="small" className="text-ui-fg-subtle">
                          Creator invited — they'll get an affiliate link once
                          they accept or claim the bounty.
                        </Text>
                      )}
                      <div className="mt-2">
                        <Button size="small" variant="secondary" onClick={resetForm}>
                          Done
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <Label size="small">Product title</Label>
                        <Input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Compost — 1 cu ft"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label size="small">Price (USD)</Label>
                        <Input
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          placeholder="12.00"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label size="small">Coalition id (optional)</Label>
                        <Input
                          value={cooperativeId}
                          onChange={(e) => setCooperativeId(e.target.value)}
                          placeholder="coop_…"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label size="small">Bounty amount (optional)</Label>
                        <Input
                          value={bountyAmount}
                          onChange={(e) => setBountyAmount(e.target.value)}
                          placeholder="50"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="flex gap-2 md:col-span-2">
                        <Button
                          size="small"
                          onClick={() => submitLaunch(creator.creator_seller_id)}
                          isLoading={submitting}
                        >
                          Create launch
                        </Button>
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={resetForm}
                          disabled={submitting}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Container>
  )
}

export default FindCreatorsPage
