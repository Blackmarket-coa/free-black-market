import { useEffect, useMemo, useState } from "react"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  Select,
  toast,
  clx,
} from "@medusajs/ui"
import { ArrowLeft, ArrowRight, CheckCircleSolid } from "@medusajs/icons"
import { backendUrl, getAuthToken } from "../../lib/client"
import { PlaybookPicker } from "../playbook/playbook-picker"
import { PLAYBOOK_DISPLAY_NAMES } from "../playbook/playbook-picker"
import { ResourceQuiz } from "../playbook/resource-quiz"
import {
  usePlaybookAssignment,
  useAssignPlaybook,
} from "../../hooks/api/playbook"

/**
 * Sprint A (FEATURE_BUILD_PLAN.md A1-A10) launch-first onboarding wizard.
 * Drives `tenancy.OnboardingState.wizard_step` through:
 *   step_1 (selling type) → step_2 (listing) → step_3 (delivery) → step_4 (publish)
 *
 * Each step autosaves to /vendor/onboarding (A9). The publish step posts
 * to /vendor/onboarding/publish, flipping `wizard_step` to `published`
 * and emitting `vendor.onboarding.first_listing_published`.
 */

type SellingType = "physical" | "digital" | "service" | "event_class"
type WizardStep = "signup" | "step_1" | "step_2" | "step_3" | "step_4" | "published"

interface OnboardingState {
  id: string
  selling_type: SellingType | null
  wizard_step: WizardStep
  wizard_step_completed_at: Record<string, string> | null
  first_published_listing_id: string | null
}

const STEPS: Array<{ id: WizardStep; title: string }> = [
  { id: "step_1", title: "Selling type" },
  { id: "step_2", title: "Listing" },
  { id: "step_3", title: "Delivery" },
  { id: "step_4", title: "Publish" },
]

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken()
  const res = await fetch(`${backendUrl.replace(/\/$/, "")}${path}`, {
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

const SELLING_TYPE_DEFAULTS: Record<
  SellingType,
  {
    label: string
    delivery_label: string
    delivery_hint: string
    archetype_code: string
    advanced_visible_default: boolean
  }
> = {
  physical: {
    label: "Physical goods",
    delivery_label: "Manual shipping (you ship from your location)",
    delivery_hint: "We'll set up a default manual shipping option. Add carrier integrations later.",
    archetype_code: "NON_PERISHABLE",
    advanced_visible_default: false,
  },
  digital: {
    label: "Digital downloads",
    delivery_label: "Instant delivery (no shipping)",
    delivery_hint: "Customers receive a download link immediately after purchase.",
    archetype_code: "DIGITAL",
    advanced_visible_default: false,
  },
  service: {
    label: "Service or coaching",
    delivery_label: "Scheduled (you schedule with the customer)",
    delivery_hint: "After purchase, customers receive a contact link to schedule. No shipping.",
    archetype_code: "SERVICE",
    advanced_visible_default: false,
  },
  event_class: {
    label: "Event or class",
    delivery_label: "Ticket / access pass",
    delivery_hint: "We'll generate a ticket or access pass per purchase. No shipping.",
    archetype_code: "TICKET",
    advanced_visible_default: false,
  },
}

export function LaunchWizard() {
  const [state, setState] = useState<OnboardingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [advanced, setAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Playbook gate — picker shows first when seller has no assignment.
  const {
    data: assignmentData,
    isPending: assignmentLoading,
  } = usePlaybookAssignment()
  const { mutateAsync: assignPlaybook, isPending: assigning } = useAssignPlaybook()
  const hasPlaybook = !!assignmentData?.playbook_assignment
  const currentRecipeId = assignmentData?.playbook_assignment?.recipe_id ?? null
  const [editingPlaybook, setEditingPlaybook] = useState(false)

  // Step 1
  const [sellingType, setSellingType] = useState<SellingType | "">("")

  // Step 2
  const [title, setTitle] = useState("")
  const [price, setPrice] = useState("")
  const [description, setDescription] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [sku, setSku] = useState("")

  // Step 4
  const [publishedListingId, setPublishedListingId] = useState<string | null>(null)

  const loadState = async () => {
    setLoading(true)
    try {
      const { state: s } = await authedFetch<{ state: OnboardingState }>(
        "/vendor/onboarding"
      )
      setState(s)
      if (s.selling_type) setSellingType(s.selling_type)
      if (s.first_published_listing_id) setPublishedListingId(s.first_published_listing_id)
    } catch (err) {
      toast.error("Failed to load onboarding state", {
        description: (err as Error).message,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadState()
  }, [])

  const currentIndex = useMemo(() => {
    if (!state) return 0
    return Math.max(0, STEPS.findIndex((s) => s.id === state.wizard_step))
  }, [state])

  const advance = async (
    step: WizardStep,
    overrides: { selling_type?: SellingType } = {}
  ) => {
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { step }
      if (overrides.selling_type !== undefined) body.selling_type = overrides.selling_type
      const { state: s } = await authedFetch<{ state: OnboardingState }>(
        "/vendor/onboarding",
        {
          method: "PATCH",
          body: JSON.stringify(body),
        }
      )
      setState(s)
    } catch (err) {
      toast.error("Could not save step", { description: (err as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  const completeStep1 = async () => {
    if (!sellingType) {
      toast.error("Pick what you're selling")
      return
    }
    await advance("step_2", { selling_type: sellingType as SellingType })
  }

  const completeStep2 = async () => {
    if (!title || !price) {
      toast.error("Title and price are required")
      return
    }
    // Note: actual product creation lives in existing product create flow.
    // Here we just record progress; vendors finish the listing in the next route.
    await advance("step_3")
  }

  const completeStep3 = async () => {
    await advance("step_4")
  }

  const completeStep4 = async (listingId: string) => {
    setSubmitting(true)
    try {
      const { state: s } = await authedFetch<{ state: OnboardingState }>(
        "/vendor/onboarding/publish",
        {
          method: "POST",
          body: JSON.stringify({ listing_id: listingId }),
        }
      )
      setState(s)
      setPublishedListingId(listingId)
      toast.success("Listing published!")
    } catch (err) {
      toast.error("Publish failed", { description: (err as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  const back = async () => {
    if (!state) return
    const idx = currentIndex
    if (idx <= 0) return
    await advance(STEPS[idx - 1].id)
  }

  const reassurance = (
    <Text size="small" className="text-ui-fg-subtle italic mt-3">
      You can edit this anytime — nothing here is final.
    </Text>
  )

  if (loading || assignmentLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Text>Loading…</Text>
      </div>
    )
  }

  if (!hasPlaybook && state?.wizard_step !== "published") {
    return (
      <div className="min-h-screen bg-ui-bg-base">
        <Container className="py-8">
          <PlaybookPicker
            onComplete={async (result) => {
              try {
                await assignPlaybook({
                  recipe_id: result.recipe_id,
                  answers: result.answers,
                  recommended_recipe_id: result.recommended_recipe_id,
                  overridden: result.overridden,
                })
                toast.success("Playbook saved — let's get your listing up")
              } catch (err) {
                toast.error("Could not save playbook", {
                  description: (err as Error).message,
                })
              }
            }}
          />
          {assigning ? (
            <div className="text-center mt-4">
              <Text size="small" className="text-ui-fg-subtle">Saving…</Text>
            </div>
          ) : null}
        </Container>
      </div>
    )
  }

  if (hasPlaybook && editingPlaybook) {
    return (
      <div className="min-h-screen bg-ui-bg-base">
        <Container className="py-8">
          <ResourceQuiz
            initial={currentRecipeId ?? undefined}
            onComplete={async (result) => {
              try {
                await assignPlaybook({
                  recipe_id: result.recipe_id,
                  recommended_recipe_id: result.recommended_recipe_id,
                  overridden: result.overridden,
                })
                toast.success("Playbook updated")
              } catch (err) {
                toast.error("Could not update playbook", {
                  description: (err as Error).message,
                })
              } finally {
                setEditingPlaybook(false)
              }
            }}
            onCancel={() => setEditingPlaybook(false)}
          />
          {assigning ? (
            <div className="text-center mt-4">
              <Text size="small" className="text-ui-fg-subtle">Saving…</Text>
            </div>
          ) : null}
        </Container>
      </div>
    )
  }

  if (state?.wizard_step === "published") {
    return (
      <Container className="py-8 max-w-2xl mx-auto">
        <div className="text-center">
          <CheckCircleSolid className="w-12 h-12 text-ui-tag-green-icon mx-auto mb-3" />
          <Heading level="h1">You're live!</Heading>
          <Text className="text-ui-fg-subtle mt-2">
            Your first listing is published. Time to share it.
          </Text>
          {publishedListingId ? (
            <Text className="font-mono text-xs mt-2">{publishedListingId}</Text>
          ) : null}
          <div className="flex gap-2 justify-center mt-6">
            <Button variant="secondary" onClick={() => (window.location.href = "/dashboard")}>
              Go to dashboard
            </Button>
            <Button onClick={() => (window.location.href = "/products")}>Manage products</Button>
          </div>
        </div>
      </Container>
    )
  }

  const stepId = state?.wizard_step ?? "step_1"
  const sellingTypeMeta = sellingType ? SELLING_TYPE_DEFAULTS[sellingType as SellingType] : null

  return (
    <div className="min-h-screen bg-ui-bg-base">
      <div className="border-b border-ui-border-base bg-ui-bg-subtle">
        <Container className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Badge color="blue">Launch wizard</Badge>
              <Text className="text-ui-fg-subtle">
                Step {currentIndex + 1} of {STEPS.length}
              </Text>
            </div>
            <div className="hidden md:flex items-center gap-2">
              {STEPS.map((s, i) => (
                <div key={s.id} className={clx("flex items-center gap-2", i < STEPS.length - 1 && "pr-4")}>
                  <div
                    className={clx(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                      i < currentIndex
                        ? "bg-ui-tag-green-bg text-ui-tag-green-icon"
                        : i === currentIndex
                        ? "bg-ui-bg-interactive text-ui-fg-on-color"
                        : "bg-ui-bg-component text-ui-fg-muted"
                    )}
                  >
                    {i < currentIndex ? <CheckCircleSolid className="w-5 h-5" /> : i + 1}
                  </div>
                  <Text size="small" className={clx(i <= currentIndex ? "text-ui-fg-base" : "text-ui-fg-muted")}>
                    {s.title}
                  </Text>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </div>

      <Container className="py-8 max-w-2xl mx-auto">
        {hasPlaybook && currentRecipeId ? (
          <div className="mb-6 flex items-center justify-between rounded-md border border-ui-border-base bg-ui-bg-subtle px-4 py-2">
            <Text size="small" className="text-ui-fg-subtle">
              Your playbook:{" "}
              <span className="text-ui-fg-base font-medium">
                {PLAYBOOK_DISPLAY_NAMES[currentRecipeId]}
              </span>
            </Text>
            <button
              type="button"
              onClick={() => setEditingPlaybook(true)}
              className="text-sm text-ui-fg-interactive hover:underline"
            >
              Change
            </button>
          </div>
        ) : null}
        {stepId === "step_1" || stepId === "signup" ? (
          <div>
            <Heading level="h1">What are you selling?</Heading>
            <Text className="text-ui-fg-subtle mt-1">
              Pick the closest match. You can add more types later.
            </Text>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
              {(Object.keys(SELLING_TYPE_DEFAULTS) as SellingType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setSellingType(t)}
                  className={clx(
                    "border rounded-md p-4 text-left",
                    sellingType === t
                      ? "border-ui-border-interactive bg-ui-bg-base-hover"
                      : "border-ui-border-base"
                  )}
                >
                  <Text className="font-medium">{SELLING_TYPE_DEFAULTS[t].label}</Text>
                </button>
              ))}
            </div>
            {reassurance}
            <div className="flex justify-end mt-6">
              <Button onClick={completeStep1} disabled={!sellingType || submitting}>
                Continue
                <ArrowRight className="ml-2" />
              </Button>
            </div>
          </div>
        ) : null}

        {stepId === "step_2" ? (
          <div>
            <Heading level="h1">Your first listing</Heading>
            <Text className="text-ui-fg-subtle mt-1">
              Just the essentials — you can polish later.
            </Text>
            <div className="grid grid-cols-1 gap-3 mt-6">
              <div>
                <Label htmlFor="lw-title">Title</Label>
                <Input id="lw-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="lw-price">Price (USD)</Label>
                <Input
                  id="lw-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lw-desc">Description</Label>
                <Textarea
                  id="lw-desc"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lw-img">Image URL</Label>
                <Input id="lw-img" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
              </div>
            </div>

            <button
              type="button"
              className="text-sm text-ui-fg-interactive mt-4"
              onClick={() => setAdvanced((v) => !v)}
            >
              {advanced ? "Hide" : "Show"} advanced fields
            </button>
            {advanced ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div>
                  <Label htmlFor="lw-sku">SKU</Label>
                  <Input id="lw-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
                </div>
              </div>
            ) : null}

            {reassurance}
            <div className="flex justify-between mt-6">
              <Button variant="secondary" onClick={back} disabled={submitting}>
                <ArrowLeft className="mr-2" />
                Back
              </Button>
              <Button onClick={completeStep2} disabled={submitting}>
                Continue
                <ArrowRight className="ml-2" />
              </Button>
            </div>
          </div>
        ) : null}

        {stepId === "step_3" ? (
          <div>
            <Heading level="h1">Delivery</Heading>
            <Text className="text-ui-fg-subtle mt-1">
              We picked sensible defaults for {sellingTypeMeta?.label.toLowerCase() ?? "your selling type"}.
            </Text>
            <div className="bg-ui-bg-subtle rounded-md p-4 mt-4">
              <Text className="font-medium">{sellingTypeMeta?.delivery_label}</Text>
              <Text className="text-ui-fg-subtle text-sm mt-1">{sellingTypeMeta?.delivery_hint}</Text>
            </div>
            {reassurance}
            <div className="flex justify-between mt-6">
              <Button variant="secondary" onClick={back} disabled={submitting}>
                <ArrowLeft className="mr-2" />
                Back
              </Button>
              <Button onClick={completeStep3} disabled={submitting}>
                Continue
                <ArrowRight className="ml-2" />
              </Button>
            </div>
          </div>
        ) : null}

        {stepId === "step_4" ? (
          <div>
            <Heading level="h1">Publish</Heading>
            <Text className="text-ui-fg-subtle mt-1">
              Paste an existing draft listing's id to mark it as your first published listing,
              or create one in the Products page and come back.
            </Text>
            <div className="grid grid-cols-1 gap-3 mt-6">
              <div>
                <Label htmlFor="lw-listing">Listing ID</Label>
                <Input
                  id="lw-listing"
                  value={publishedListingId ?? ""}
                  onChange={(e) => setPublishedListingId(e.target.value)}
                  placeholder="prod_..."
                />
              </div>
            </div>
            {reassurance}
            <div className="flex justify-between mt-6">
              <Button variant="secondary" onClick={back} disabled={submitting}>
                <ArrowLeft className="mr-2" />
                Back
              </Button>
              <Button
                onClick={() => publishedListingId && void completeStep4(publishedListingId)}
                disabled={!publishedListingId || submitting}
              >
                Publish & celebrate
              </Button>
            </div>
          </div>
        ) : null}
      </Container>
    </div>
  )
}

export default LaunchWizard
