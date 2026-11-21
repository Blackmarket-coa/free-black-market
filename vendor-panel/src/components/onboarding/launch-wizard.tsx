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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { backendUrl, getAuthToken } from "../../lib/client"
import { PlaybookPicker } from "../playbook/playbook-picker"
import { PLAYBOOK_DISPLAY_NAMES } from "../playbook/playbook-picker"
import { ResourceQuiz, type ResourceKey } from "../playbook/resource-quiz"
import type { PlaybookId } from "../playbook/playbook-picker/recommend"
import {
  usePlaybookAssignment,
  useAssignPlaybook,
} from "../../hooks/api/playbook"
import { useIsBusy } from "../../hooks/api/selling-setup"
import {
  DeliveryStep,
  ListingStep,
  PublishedScreen,
  PublishStep,
  readWizardProduct,
  writeWizardProduct,
  type SellingType,
  type WizardProduct,
} from "./launch-wizard-steps"

/**
 * Sprint A (FEATURE_BUILD_PLAN.md A1-A10) launch-first onboarding wizard.
 * Drives `tenancy.OnboardingState.wizard_step` through:
 *   step_1 (selling type) → step_2 (listing) → step_3 (delivery) → step_4 (publish)
 *
 * Each step autosaves to /vendor/onboarding (A9), and each does what it
 * says (SD-151 (4), launch-wizard-steps.tsx): the listing step creates a
 * draft product, the delivery step sets up pickup or shipping, and the
 * publish step publishes that product and posts it to
 * /vendor/onboarding/publish, which flips `wizard_step` to `published` and
 * emits `vendor.onboarding.first_listing_published`.
 */

type WizardStep =
  | "signup"
  | "step_1"
  | "step_2"
  | "step_3"
  | "cottage_food"
  | "step_4"
  | "published"

interface OnboardingState {
  id: string
  selling_type: SellingType | null
  wizard_step: WizardStep
  wizard_step_completed_at: Record<string, string> | null
  first_published_listing_id: string | null
}

const BASE_STEPS: Array<{ id: WizardStep; title: string }> = [
  { id: "step_1", title: "Selling type" },
  { id: "step_2", title: "Listing" },
  { id: "step_3", title: "Delivery" },
  { id: "step_4", title: "Publish" },
]

const COTTAGE_FOOD_STEP = { id: "cottage_food" as WizardStep, title: "Home kitchen" }

/**
 * Steps for this seller.
 *
 * The home-kitchen step is inserted before Publish only for sellers who said
 * they make their product at home. Every other seller gets the original
 * four-step wizard, unchanged — a food-specific step in everyone's progress
 * bar would be noise for the majority of vendors.
 */
function stepsFor(homeKitchen: boolean): Array<{ id: WizardStep; title: string }> {
  if (!homeKitchen) return BASE_STEPS
  const steps = [...BASE_STEPS]
  steps.splice(BASE_STEPS.length - 1, 0, COTTAGE_FOOD_STEP)
  return steps
}

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
    let message = ""
    try {
      message = String(JSON.parse(body)?.message ?? "")
    } catch {
      // Not JSON: the text itself is all there is.
    }
    throw new Error(message || `${res.status}: ${body || res.statusText}`)
  }
  return (await res.json()) as T
}

const STATE_KEY = ["launch-wizard", "state"] as const
const COTTAGE_KEY = ["launch-wizard", "cottage-food"] as const
const ADVANCE_KEY = ["launch-wizard", "advance"] as const

type CottageFoodOnboarding = {
  needs_setup: boolean
  profile: {
    operation_type?: "SHELF_STABLE" | "HOME_KITCHEN" | "BOTH"
    jurisdiction_label?: string | null
    permit_number?: string | null
    label_disclosure_text?: string | null
  } | null
}

/**
 * Presentational copy per selling type.
 *
 * This table used to carry an `archetype_code` per entry that nothing read —
 * it was never sent anywhere, so the panel held a mapping that looked
 * authoritative and decided nothing. The mapping now lives on the backend in
 * `modules/tenancy/selling-type-archetype.ts`, where the compiler can require
 * it to be total and a test can require its targets to be real, and the
 * onboarding GET response returns the resolved `archetype_code` alongside the
 * state. What is left here is copy. docs/TRANSMUTATION_STRATEGY.md §4.1.
 *
 * The copy says only what happens (SD-151 (4)). It used to promise a default
 * shipping option, a download link sent on purchase, a contact link and a
 * generated ticket; the wizard's listing is an ordinary product and none of
 * those is made for it.
 */
export const SELLING_TYPE_DEFAULTS: Record<
  SellingType,
  {
    label: string
    delivery_label: string
    delivery_hint: string
    advanced_visible_default: boolean
  }
> = {
  physical: {
    label: "Physical goods",
    delivery_label: "Pickup, shipping, or both",
    delivery_hint:
      "You say where your goods are and how buyers get them, and hand over or ship each order yourself.",
    advanced_visible_default: false,
  },
  digital: {
    label: "Digital downloads",
    delivery_label: "Nothing is shipped",
    delivery_hint:
      "After an order you send the buyer their download yourself: this listing does not send files.",
    advanced_visible_default: false,
  },
  service: {
    label: "Service or coaching",
    delivery_label: "Arranged with the buyer",
    delivery_hint:
      "After an order you contact the buyer to schedule: this listing does not book a time.",
    advanced_visible_default: false,
  },
  event_class: {
    label: "Event or class",
    delivery_label: "You send the details",
    delivery_hint:
      "After an order you send the buyer the place and time yourself: this listing does not issue a ticket.",
    advanced_visible_default: false,
  },
  reclaimed: {
    label: "Repaired or salvaged goods",
    delivery_label: "Pickup, shipping, or both",
    delivery_hint:
      "Condition-graded listings: state each item's grade (Like New, Good, Fair or Parts Only) and its repair history in the description.",
    advanced_visible_default: false,
  },
}

export function LaunchWizard() {
  const client = useQueryClient()

  // The seller's onboarding state. Read with the query client, so that each
  // step's answer from the backend is what the next render shows.
  const {
    data: onboarding,
    isPending: loading,
    isError: loadFailed,
    error: loadError,
    refetch: reload,
  } = useQuery({
    queryKey: STATE_KEY,
    queryFn: () =>
      authedFetch<{ state: OnboardingState }>("/vendor/onboarding"),
    enabled: Boolean(getAuthToken()),
    retry: false,
  })
  const state = onboarding?.state ?? null
  const setState = (next: OnboardingState) =>
    client.setQueryData(STATE_KEY, { ...onboarding, state: next })

  // A saved cottage-food profile *is* the home-kitchen flag — no extra
  // column on onboarding state, and the wizard stays correct if the seller
  // set it up from the dashboard instead of here. Cottage food is opt-in and
  // entirely optional; a failure to read it must not stop someone from
  // onboarding.
  const { data: cottage } = useQuery({
    queryKey: COTTAGE_KEY,
    queryFn: () =>
      authedFetch<CottageFoodOnboarding>("/vendor/cottage-food/onboarding"),
    enabled: Boolean(getAuthToken()),
    retry: false,
  })

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
  const [sellingTypeChoice, setSellingType] = useState<SellingType | "">("")
  const sellingType: SellingType | "" =
    sellingTypeChoice || state?.selling_type || ""

  // Step 1 — orthogonal to selling type: food is physical goods, but *where
  // it's made* is what changes the permits, labels, and limits that apply.
  const [homeKitchenChoice, setHomeKitchenChoice] = useState<boolean | null>(
    null
  )
  const homeKitchen = homeKitchenChoice ?? cottage?.needs_setup === false

  // Cottage food step
  const [cottageOperation, setCottageOperation] =
    useState<"SHELF_STABLE" | "HOME_KITCHEN" | "BOTH">("SHELF_STABLE")
  const [cottageJurisdiction, setCottageJurisdiction] = useState("")
  const [cottagePermit, setCottagePermit] = useState("")
  const [cottageDisclosure, setCottageDisclosure] = useState("")
  useEffect(() => {
    if (!cottage || cottage.needs_setup) return
    if (cottage.profile?.operation_type) {
      setCottageOperation(cottage.profile.operation_type)
    }
    setCottageJurisdiction(cottage.profile?.jurisdiction_label ?? "")
    setCottagePermit(cottage.profile?.permit_number ?? "")
    setCottageDisclosure(cottage.profile?.label_disclosure_text ?? "")
  }, [cottage])

  // The product the listing step created: remembered in this browser under
  // the onboarding state, so a reload between steps keeps it.
  const [productOverride, setProductOverride] = useState<
    WizardProduct | null | undefined
  >(undefined)
  const wizardProduct =
    productOverride !== undefined
      ? productOverride
      : state
        ? readWizardProduct(state.id)
        : null
  const rememberProduct = (product: WizardProduct | null) => {
    if (state) writeWizardProduct(state.id, product)
    setProductOverride(product)
  }

  const steps = useMemo(() => stepsFor(homeKitchen), [homeKitchen])

  const currentIndex = useMemo(() => {
    if (!state) return 0
    return Math.max(0, steps.findIndex((s) => s.id === state.wizard_step))
  }, [state, steps])

  // One mutation for a step's own save (`before`) and the record of the step
  // reached, so that its key covers the whole press.
  const advanceStep = useMutation({
    mutationKey: ADVANCE_KEY,
    mutationFn: async ({
      body,
      before,
    }: {
      body: Record<string, unknown>
      before?: () => Promise<void>
    }) => {
      await before?.()
      return authedFetch<{ state: OnboardingState }>("/vendor/onboarding", {
        method: "PATCH",
        body: JSON.stringify(body),
      })
    },
    onSuccess: ({ state: s }) => setState(s),
  })
  const { pending: submitting, isBusyNow } = useIsBusy(ADVANCE_KEY)

  /** Record the step reached. Resolves false, with a toast, when it was not saved. */
  const advance = async (
    step: WizardStep,
    overrides: { selling_type?: SellingType } = {},
    before?: () => Promise<void>
  ) => {
    const body: Record<string, unknown> = { step }
    if (overrides.selling_type !== undefined) body.selling_type = overrides.selling_type
    try {
      await advanceStep.mutateAsync({ body, before })
      return true
    } catch (err) {
      toast.error("Could not save step", { description: (err as Error).message })
      return false
    }
  }

  const completeStep1 = async () => {
    if (isBusyNow()) return
    if (!sellingType) {
      toast.error("Pick what you're selling")
      return
    }
    await advance(
      "step_2",
      { selling_type: sellingType as SellingType },
      async () => {
        // Create the profile up front so the home-kitchen step appears and
        // the seller's dashboard is ready the moment they land on it. Empty
        // body — every field is filled in later and all of them are optional.
        if (!homeKitchen) return
        try {
          await authedFetch("/vendor/cottage-food/onboarding", {
            method: "POST",
            body: JSON.stringify({}),
          })
        } catch {
          // Non-fatal: they can still set this up from the dashboard.
        }
      }
    )
  }

  /**
   * Save whatever the seller filled in and move on. Nothing is required — a
   * home cook who doesn't have their permit number to hand should be able to
   * finish onboarding and come back to it, so this always advances.
   */
  const completeCottageFood = async () => {
    if (isBusyNow()) return
    await advance("step_4", {}, async () => {
      try {
        await authedFetch("/vendor/cottage-food/onboarding", {
          method: "POST",
          body: JSON.stringify({
            operation_type: cottageOperation,
            jurisdiction_label: cottageJurisdiction,
            permit_number: cottagePermit,
            label_disclosure_text: cottageDisclosure,
          }),
        })
      } catch (err) {
        toast.error("Couldn't save that — you can add it later from Cottage food", {
          description: (err as Error).message,
        })
      }
    })
  }

  const back = async () => {
    if (!state || isBusyNow()) return
    const idx = currentIndex
    if (idx <= 0) return
    await advance(steps[idx - 1].id)
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

  if (loadFailed || !state) {
    return (
      <Container className="py-8 max-w-2xl mx-auto">
        <Heading level="h1">Your onboarding could not be loaded</Heading>
        <Text className="text-ui-fg-subtle mt-2">
          {(loadError as Error | null)?.message ?? "Please try again."}
        </Text>
        <div className="flex gap-2 mt-6">
          <Button variant="secondary" onClick={() => reload()}>
            Try again
          </Button>
          <Button onClick={() => (window.location.href = "/dashboard")}>
            Go to dashboard
          </Button>
        </div>
      </Container>
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
    const currentMeta = assignmentData?.playbook_assignment?.metadata
    const initialRoles = (currentMeta?.roles ??
      (currentRecipeId ? [currentRecipeId] : [])) as PlaybookId[]
    const initialResources = (currentMeta?.resources ?? []) as ResourceKey[]
    return (
      <div className="min-h-screen bg-ui-bg-base">
        <Container className="py-8">
          <ResourceQuiz
            initial={currentRecipeId ?? undefined}
            initialRoles={initialRoles}
            initialResources={initialResources}
            // Re-running the quiz edits the playbook only. Node operating is
            // turned on and off in Settings → Run deliveries, which is the one
            // place that can show the credential secret it hands back.
            offerNodeOperatorOptIn={false}
            onComplete={async (result) => {
              try {
                await assignPlaybook({
                  recipe_id: result.recipe_id,
                  recommended_recipe_id: result.recommended_recipe_id,
                  overridden: result.overridden,
                  roles: result.roles,
                  resources: result.resources,
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
        <PublishedScreen />
      </Container>
    )
  }

  const stepId = state?.wizard_step ?? "step_1"
  const chosenType = (sellingType || null) as SellingType | null

  return (
    <div className="min-h-screen bg-ui-bg-base">
      <div className="border-b border-ui-border-base bg-ui-bg-subtle">
        <Container className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Badge color="blue">Launch wizard</Badge>
              <Text className="text-ui-fg-subtle">
                Step {currentIndex + 1} of {steps.length}
              </Text>
            </div>
            <div className="hidden md:flex items-center gap-2">
              {steps.map((s, i) => (
                <div key={s.id} className={clx("flex items-center gap-2", i < steps.length - 1 && "pr-4")}>
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
            {sellingType === "physical" ? (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-ui-border-base p-4">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={homeKitchen}
                  onChange={(e) => setHomeKitchenChoice(e.target.checked)}
                />
                <span>
                  <Text className="font-medium">I make it in my home kitchen</Text>
                  <Text size="small" className="text-ui-fg-subtle mt-1">
                    Cottage food, home baking, or cooked meals sold from home. We'll
                    add a step to track your permit, your sales cap, and what your
                    labels need to say. All optional, and none of it restricts your
                    store.
                  </Text>
                </span>
              </label>
            ) : null}
            {reassurance}
            <div className="flex justify-end mt-6">
              <Button
                onClick={completeStep1}
                disabled={!sellingType || submitting}
                isLoading={submitting}
              >
                Continue
                <ArrowRight className="ml-2" />
              </Button>
            </div>
          </div>
        ) : null}

        {stepId === "step_2" ? (
          <ListingStep
            sellingType={chosenType}
            existing={wizardProduct}
            onCreated={async (product) => {
              // Remembered before the step is recorded: the product exists
              // whether or not the next request answers.
              rememberProduct(product)
              await advance("step_3")
            }}
            onContinue={async () => {
              if (isBusyNow()) return
              await advance("step_3")
            }}
            onStartOver={() => rememberProduct(null)}
            onBack={back}
          />
        ) : null}

        {stepId === "step_3" ? (
          <DeliveryStep
            sellingType={chosenType}
            product={wizardProduct}
            onStockRecorded={rememberProduct}
            onContinue={async () => {
              await advance(homeKitchen ? "cottage_food" : "step_4")
            }}
            onBack={back}
          />
        ) : null}

        {stepId === "cottage_food" ? (
          <div>
            <Heading level="h1">Your home kitchen</Heading>
            <Text className="text-ui-fg-subtle mt-1">
              Cottage food rules differ by state and often by county, so we don't
              guess at yours — tell us what applies to you and we'll keep count
              against it. Skip anything you don't have yet.
            </Text>
            <div className="grid grid-cols-1 gap-3 mt-6">
              <div>
                <Label htmlFor="lw-cf-op">What do you make?</Label>
                <Select
                  value={cottageOperation}
                  onValueChange={(v) =>
                    setCottageOperation(v as "SHELF_STABLE" | "HOME_KITCHEN" | "BOTH")
                  }
                >
                  <Select.Trigger id="lw-cf-op">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="SHELF_STABLE">
                      Shelf-stable goods (baked goods, jams, candy)
                    </Select.Item>
                    <Select.Item value="HOME_KITCHEN">
                      Cooked meals from my home kitchen
                    </Select.Item>
                    <Select.Item value="BOTH">Both</Select.Item>
                  </Select.Content>
                </Select>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Cooked meals usually carry per-day and per-week limits on top of
                  an annual one, so this decides which counters you get.
                </Text>
              </div>
              <div>
                <Label htmlFor="lw-cf-juris">Where you're permitted</Label>
                <Input
                  id="lw-cf-juris"
                  placeholder="Riverside County, CA"
                  value={cottageJurisdiction}
                  onChange={(e) => setCottageJurisdiction(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lw-cf-permit">Permit number</Label>
                <Input
                  id="lw-cf-permit"
                  value={cottagePermit}
                  onChange={(e) => setCottagePermit(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lw-cf-disc">Required label wording</Label>
                <Textarea
                  id="lw-cf-disc"
                  rows={3}
                  placeholder="Made in a home kitchen that is not inspected by the Department of State Health Services."
                  value={cottageDisclosure}
                  onChange={(e) => setCottageDisclosure(e.target.value)}
                />
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Most places require exact wording. Paste yours verbatim and it
                  goes on every label you generate — we won't write it for you,
                  because getting it slightly wrong is worse than leaving it out.
                </Text>
              </div>
            </div>
            <Text size="small" className="text-ui-fg-subtle italic mt-3">
              You can set your sales cap, meal limits, and expiry reminders later
              under Cottage food.
            </Text>
            <div className="flex justify-between mt-6">
              <Button variant="secondary" onClick={back} disabled={submitting}>
                <ArrowLeft className="mr-2" />
                Back
              </Button>
              <Button onClick={completeCottageFood} disabled={submitting}>
                Continue
                <ArrowRight className="ml-2" />
              </Button>
            </div>
          </div>
        ) : null}

        {stepId === "step_4" ? (
          <PublishStep
            product={wizardProduct}
            onPublished={(published) => setState(published as OnboardingState)}
            onMakeListing={() => {
              if (isBusyNow()) return
              void advance("step_2")
            }}
            onForget={() => rememberProduct(null)}
            onBack={back}
          />
        ) : null}
      </Container>
    </div>
  )
}

export default LaunchWizard
