import { useState } from "react"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  ProgressTabs,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { backendUrl, getAuthToken } from "../../lib/client"

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)

interface LaunchResult {
  launch_id: string
  product_id: string
  demand_post_id: string
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

/**
 * "Launch a Business" guided wizard — start selling without outside help.
 * Step 1 captures the producer profile; step 2 the first product. On submit it
 * POSTs launch_type=BUSINESS to /v1/seller/launches, which ensures the producer
 * profile exists and then runs the standard product-launch flow.
 */
export const LaunchBusinessPage = () => {
  const [step, setStep] = useState<"profile" | "product">("profile")
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<LaunchResult | null>(null)

  // Step 1 — business profile
  const [businessName, setBusinessName] = useState("")
  const [handle, setHandle] = useState("")
  const [region, setRegion] = useState("")

  // Step 2 — first product
  const [productTitle, setProductTitle] = useState("")
  const [price, setPrice] = useState("")
  const [description, setDescription] = useState("")

  const goToProduct = () => {
    if (!businessName.trim()) {
      toast.error("Business name is required")
      return
    }
    setStep("product")
  }

  const submit = async () => {
    if (!productTitle.trim() || !price.trim()) {
      toast.error("Product title and price are required")
      return
    }
    setSubmitting(true)
    try {
      const priceCents = Math.round(parseFloat(price) * 100)
      const res = await authedFetch<{ launch: LaunchResult }>(
        "/v1/seller/launches",
        {
          method: "POST",
          body: JSON.stringify({
            launch_type: "BUSINESS",
            title: productTitle.trim(),
            slug: slugify(productTitle),
            price: Number.isFinite(priceCents) ? priceCents : 0,
            description: description.trim() || undefined,
            business: {
              producer_name: businessName.trim(),
              producer_handle: handle.trim() || slugify(businessName),
              region: region.trim() || undefined,
            },
          }),
        }
      )
      setResult(res.launch)
      toast.success("Business launched 🎉")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <Container className="p-6">
        <Heading level="h1">Business launched 🎉</Heading>
        <Text className="text-ui-fg-subtle mt-2" size="small">
          Your producer profile is live and your first product is published.
        </Text>
        <Text className="text-ui-fg-subtle mt-4" size="small">
          Product: {result.product_id}
        </Text>
        <Text className="text-ui-fg-subtle" size="small">
          Launch: {result.launch_id}
        </Text>
      </Container>
    )
  }

  return (
    <Container className="p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Launch a Business</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Set up your profile and your first product in two steps — no outside
          help required.
        </Text>
      </div>

      <ProgressTabs value={step} className="border-t">
        <ProgressTabs.List>
          <ProgressTabs.Trigger
            value="profile"
            status={step === "product" ? "completed" : "in-progress"}
            onClick={() => setStep("profile")}
          >
            Business profile
          </ProgressTabs.Trigger>
          <ProgressTabs.Trigger
            value="product"
            status={step === "product" ? "in-progress" : "not-started"}
            onClick={goToProduct}
          >
            First product
          </ProgressTabs.Trigger>
        </ProgressTabs.List>

        <ProgressTabs.Content value="profile" className="px-6 py-6">
          <div className="grid max-w-xl grid-cols-1 gap-4">
            <div className="flex flex-col gap-1">
              <Label size="small">Business name</Label>
              <Input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Sunrise Farm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label size="small">Handle (optional)</Label>
              <Input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="sunrise-farm"
              />
              <Text size="xsmall" className="text-ui-fg-muted">
                Used in your public profile URL. Defaults to your business name.
              </Text>
            </div>
            <div className="flex flex-col gap-1">
              <Label size="small">Region (optional)</Label>
              <Input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="Pacific Northwest"
              />
            </div>
            <div>
              <Button size="small" onClick={goToProduct}>
                Next: first product
              </Button>
            </div>
          </div>
        </ProgressTabs.Content>

        <ProgressTabs.Content value="product" className="px-6 py-6">
          <div className="grid max-w-xl grid-cols-1 gap-4">
            <div className="flex flex-col gap-1">
              <Label size="small">Product title</Label>
              <Input
                value={productTitle}
                onChange={(e) => setProductTitle(e.target.value)}
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
              <Label size="small">Description (optional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What you're selling and why it's great."
              />
            </div>
            <div className="flex gap-2">
              <Button size="small" onClick={submit} isLoading={submitting}>
                Launch business
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={() => setStep("profile")}
                disabled={submitting}
              >
                Back
              </Button>
            </div>
          </div>
        </ProgressTabs.Content>
      </ProgressTabs>
    </Container>
  )
}

export default LaunchBusinessPage
