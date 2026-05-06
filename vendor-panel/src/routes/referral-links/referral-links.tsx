import { useEffect, useState } from "react"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"
import { backendUrl, getAuthToken } from "../../lib/client"

interface AffiliateLink {
  id: string
  short_code: string
  creator_seller_id: string
  product_id: string | null
  collection_id: string | null
  destination_path: string
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  status: "active" | "paused" | "revoked"
  click_count: number
  attributed_order_count: number
  created_at: string
}

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

const buildShareUrl = (shortCode: string) => {
  const base = (import.meta as any).env?.VITE_STOREFRONT_URL ?? ""
  if (!base) {
    return `/r/${shortCode}`
  }
  return `${String(base).replace(/\/$/, "")}/r/${shortCode}`
}

export const ReferralLinksPage = () => {
  const [links, setLinks] = useState<AffiliateLink[]>([])
  const [productId, setProductId] = useState("")
  const [collectionId, setCollectionId] = useState("")
  const [campaign, setCampaign] = useState("")
  const [destinationPath, setDestinationPath] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    setLoading(true)
    try {
      const { links: list } = await authedFetch<{ links: AffiliateLink[] }>(
        "/vendor/affiliate-links"
      )
      setLinks(list)
    } catch (err) {
      toast.error("Failed to load referral links", {
        description: (err as Error).message,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const create = async () => {
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {}
      if (productId) body.product_id = productId
      if (collectionId) body.collection_id = collectionId
      if (campaign) body.utm_campaign = campaign
      if (destinationPath) body.destination_path = destinationPath
      await authedFetch("/vendor/affiliate-links", {
        method: "POST",
        body: JSON.stringify(body),
      })
      toast.success("Referral link created")
      setProductId("")
      setCollectionId("")
      setCampaign("")
      setDestinationPath("")
      await reload()
    } catch (err) {
      toast.error("Failed to create link", {
        description: (err as Error).message,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const revoke = async (id: string) => {
    if (!window.confirm("Revoke this referral link? It will stop attributing new orders.")) return
    try {
      await authedFetch(`/vendor/affiliate-links/${id}`, { method: "DELETE" })
      toast.success("Link revoked")
      await reload()
    } catch (err) {
      toast.error("Revoke failed", { description: (err as Error).message })
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied")
    } catch {
      toast.error("Could not copy")
    }
  }

  return (
    <Container className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Heading level="h1">Referral links</Heading>
      </div>

      <div className="border border-ui-border-base rounded-md p-4 flex flex-col gap-3">
        <Heading level="h2">Create a new link</Heading>
        <Text className="text-ui-fg-subtle">
          Generate a short code your audience can use. Visiting{" "}
          <code>/r/&lt;code&gt;</code> stamps the visitor for attribution; orders
          placed within the cookie window credit the link.
        </Text>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="rl-product">Product ID (optional)</Label>
            <Input
              id="rl-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder="prod_..."
            />
          </div>
          <div>
            <Label htmlFor="rl-collection">Collection ID (optional)</Label>
            <Input
              id="rl-collection"
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              placeholder="pcol_..."
            />
          </div>
          <div>
            <Label htmlFor="rl-campaign">Campaign tag (optional)</Label>
            <Input
              id="rl-campaign"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="spring-launch"
            />
          </div>
          <div>
            <Label htmlFor="rl-dest">Destination path (optional)</Label>
            <Input
              id="rl-dest"
              value={destinationPath}
              onChange={(e) => setDestinationPath(e.target.value)}
              placeholder="/products/abc"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={create} disabled={submitting}>
            {submitting ? "Creating..." : "Create referral link"}
          </Button>
        </div>
      </div>

      <div className="border border-ui-border-base rounded-md p-4">
        <Heading level="h2" className="mb-3">
          Your links ({links.length})
        </Heading>
        {loading ? (
          <Text className="text-ui-fg-subtle">Loading…</Text>
        ) : links.length === 0 ? (
          <Text className="text-ui-fg-subtle italic">No links yet.</Text>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ui-fg-subtle border-b">
                <th className="py-2">Short code</th>
                <th className="py-2">Destination</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Clicks</th>
                <th className="py-2 text-right">Orders</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="py-2 font-mono">{l.short_code}</td>
                  <td className="py-2">{l.destination_path}</td>
                  <td className="py-2">{l.status}</td>
                  <td className="py-2 text-right">{l.click_count}</td>
                  <td className="py-2 text-right">{l.attributed_order_count}</td>
                  <td className="py-2 text-right">
                    <div className="flex gap-2 justify-end">
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => void copy(buildShareUrl(l.short_code))}
                      >
                        Copy URL
                      </Button>
                      {l.status !== "revoked" ? (
                        <Button
                          size="small"
                          variant="danger"
                          onClick={() => void revoke(l.id)}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Container>
  )
}
