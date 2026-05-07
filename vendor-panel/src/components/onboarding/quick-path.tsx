import { useState } from "react"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { backendUrl, getAuthToken } from "../../lib/client"

/**
 * Slice C — 60-second creator onboarding quick path.
 *
 * Single-form alternative to the 5-step LaunchWizard. Posts to
 * /vendor/onboarding/quick-publish which advances OnboardingState to
 * STEP_3 and stamps `quick_path_used = true`. Payout/KYC stays deferred.
 *
 * Surfaced from `<Onboarding>` when VITE_FBM_QUICK_ONBOARD === "1" and
 * the URL doesn't carry `?mode=full`.
 */

type SellingType = "physical" | "digital" | "service" | "event_class"

const SELLING_TYPE_LABELS: Record<SellingType, string> = {
  physical: "Physical goods",
  digital: "Digital downloads",
  service: "Service or coaching",
  event_class: "Event or class",
}

async function authedPost<T>(path: string, body: unknown): Promise<T> {
  const token = getAuthToken()
  const res = await fetch(`${backendUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`${res.status}: ${text || res.statusText}`)
  }
  return (await res.json()) as T
}

export function QuickPath() {
  const [submitting, setSubmitting] = useState(false)
  const [handle, setHandle] = useState("")
  const [niches, setNiches] = useState("")
  const [sellingType, setSellingType] = useState<SellingType | "">("")
  const [productTitle, setProductTitle] = useState("")
  const [productPrice, setProductPrice] = useState("")

  const onSubmit = async () => {
    if (!sellingType) {
      toast.error("Pick a selling type")
      return
    }
    setSubmitting(true)
    try {
      // Best-effort referral capture — silently no-op when no cookie.
      await authedPost("/vendor/me/onboarding/referral-capture", {}).catch(
        () => undefined
      )

      const payload = {
        selling_type: sellingType,
        handle: handle.trim() || null,
        niches: niches
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        sample_product:
          productTitle.trim() || productPrice.trim()
            ? {
                title: productTitle.trim() || null,
                price_cents: productPrice
                  ? Math.round(Number(productPrice) * 100)
                  : null,
              }
            : null,
      }

      const { next_step_url } = await authedPost<{ next_step_url: string }>(
        "/vendor/onboarding/quick-publish",
        payload
      )

      toast.success("Quick start saved — let's set up delivery")
      window.location.assign(next_step_url || "/onboarding?step=step_3")
    } catch (err) {
      toast.error("Could not save quick start", {
        description: (err as Error).message,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Container className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <Heading level="h1">Set up your store in 60 seconds</Heading>
        <Text className="text-ui-fg-subtle">
          Pick what you sell, drop in a sample product, and you're live.
          Payouts and verification are deferred until your first sale —{" "}
          <a className="underline" href="/onboarding?mode=full">
            switch to the full wizard
          </a>{" "}
          if you'd rather configure everything up front.
        </Text>
      </div>

      <div className="space-y-2">
        <Label htmlFor="selling_type">What are you selling?</Label>
        <Select
          value={sellingType}
          onValueChange={(v) => setSellingType(v as SellingType)}
        >
          <Select.Trigger id="selling_type">
            <Select.Value placeholder="Pick a type" />
          </Select.Trigger>
          <Select.Content>
            {(Object.keys(SELLING_TYPE_LABELS) as SellingType[]).map((t) => (
              <Select.Item key={t} value={t}>
                {SELLING_TYPE_LABELS[t]}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="handle">Creator handle (optional)</Label>
        <Input
          id="handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="e.g. @ourkitchen"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="niches">Niches (comma-separated, optional)</Label>
        <Textarea
          id="niches"
          value={niches}
          onChange={(e) => setNiches(e.target.value)}
          placeholder="e.g. plant-based recipes, weekly drops"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="product_title">Sample product (optional)</Label>
          <Input
            id="product_title"
            value={productTitle}
            onChange={(e) => setProductTitle(e.target.value)}
            placeholder="Title"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product_price">Price (USD)</Label>
          <Input
            id="product_price"
            type="number"
            inputMode="decimal"
            value={productPrice}
            onChange={(e) => setProductPrice(e.target.value)}
            placeholder="9.99"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button
          variant="secondary"
          onClick={() => window.location.assign("/onboarding?mode=full")}
          disabled={submitting}
        >
          Use full wizard
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? "Saving…" : "Continue to delivery"}
        </Button>
      </div>
    </Container>
  )
}

export default QuickPath
