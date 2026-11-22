import { useState } from "react"
import {
  Alert,
  Button,
  Heading,
  Input,
  Label,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { ArrowLeft, ArrowRight, CheckCircleSolid } from "@medusajs/icons"
import {
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query"
import {
  sellingSetupMutationKeys,
  useCreateProductWithStock,
  useDeliverySetup,
  useIsBusy,
  usePublishFirstListing,
  useRecordStock,
  useSellingSetup,
  type CreateProductWithStockInput,
} from "../../hooks/api/selling-setup"
import { useProducts } from "../../hooks/api/products"
import { backendMessage } from "../../lib/backend-message"
import { uploadFilesQuery } from "../../lib/client"
import {
  listingCurrency,
  SimilarProductExists,
  type DeliverySetup,
  type SellingSetup,
  unofferedReason,
} from "../../lib/selling-setup"
import { PRODUCT_CREATE_FORM_DEFAULTS } from "../../routes/products/product-create/constants"
import type { ProductCreateSchemaType } from "../../routes/products/product-create/types"
import { toCreateProductPayload } from "../../routes/products/product-create/utils"
import {
  DeliverySetupForm,
  type DeliveryAnswers,
} from "./delivery-setup-form"

/**
 * The launch wizard's listing, delivery and publish steps (SD-151 (4)).
 *
 * Each used to record progress and make nothing: the listing step dropped its
 * title, price, description, image and SKU; the delivery step said "We'll set
 * up a default manual shipping option" and nothing did; the publish step
 * asked for a pasted product id and recorded any string, then said "You're
 * live!". Each now does what it says through the backend, and says so only
 * after the backend has answered.
 */

export type SellingType =
  | "physical"
  | "digital"
  | "service"
  | "event_class"
  | "reclaimed"

/** The product the wizard's listing step created. */
export type WizardProduct = {
  id: string
  title: string
  /**
   * How many the vendor said they have, when the store had no stock location
   * to record it at yet. The delivery step records it once one exists.
   */
  pendingStock?: number | null
}

const KEY = "fbm.launch-wizard.product"

/**
 * The wizard's product is remembered in this browser, under the onboarding
 * state it belongs to, so that a reload between steps does not lose it. In
 * another browser the publish step lists the store's products instead.
 */
export const readWizardProduct = (stateId: string): WizardProduct | null => {
  try {
    const stored = JSON.parse(
      (typeof window !== "undefined" && window.localStorage.getItem(KEY)) || "null"
    )
    return stored?.state_id === stateId && typeof stored?.id === "string"
      ? {
          id: stored.id,
          title: String(stored.title ?? ""),
          pendingStock: stored.pendingStock ?? null,
        }
      : null
  } catch {
    return null
  }
}

export const writeWizardProduct = (
  stateId: string,
  product: WizardProduct | null
) => {
  if (typeof window === "undefined") return
  if (product) {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ state_id: stateId, ...product })
    )
  } else {
    window.localStorage.removeItem(KEY)
  }
}

export type ListingAnswers = {
  title: string
  /**
   * As typed, in major units of the currency buyers pay in where the store
   * is (`listingCurrency`): "12" is $12.00 in a USD region.
   */
  price: string
  description: string
  sku: string
  trackStock: boolean
  quantity: string
}

/** Goods are counted; a download, a session or a class is the vendor's call. */
export const defaultListingAnswers = (
  sellingType: SellingType | null
): ListingAnswers => ({
  title: "",
  price: "",
  description: "",
  sku: "",
  trackStock: sellingType === "physical" || sellingType === "reclaimed",
  quantity: "",
})

/**
 * The draft product the listing step asks the backend for, or what is wrong
 * with the answers. The request is the product form's own
 * (`toCreateProductPayload`): one default variant, the price as typed, in the
 * currency of the region the store's stock location is in (or of the first
 * region before there is one). A price in another currency is one no
 * buyer's cart is charged: Medusa refuses to add the variant.
 */
export const listingRequestFrom = (
  answers: ListingAnswers,
  {
    delivery,
    thumbnail,
  }: {
    delivery: Pick<DeliverySetup, "channel" | "location" | "regions"> | undefined
    thumbnail?: string
  }
):
  | { problem: string }
  | { input: CreateProductWithStockInput; pendingStock: number | null } => {
  const title = answers.title.trim()
  if (!title) {
    return { problem: "Give your listing a title." }
  }
  if (!delivery) {
    // Without it the listing would be in no sales channel, and unpriced.
    return {
      problem: "Your store's setup could not be read. Reload the page and try again.",
    }
  }
  const currency = listingCurrency(delivery)
  if (!currency) {
    return {
      problem:
        "This marketplace has no buyer region yet, so there is no currency to price your listing in. Contact support.",
    }
  }
  const typedPrice = answers.price.trim().replace(",", ".")
  const price = Number(typedPrice)
  if (typedPrice === "" || !Number.isFinite(price) || price < 0) {
    return {
      problem: `Enter a price in ${currency.toUpperCase()}. Enter 0 for something free.`,
    }
  }
  let quantity: number | null = null
  if (answers.trackStock) {
    quantity = Number(answers.quantity.trim())
    if (
      answers.quantity.trim() === "" ||
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      return {
        problem:
          "Enter how many you have (1 or more), or choose not to track stock.",
      }
    }
  }

  const channel = delivery.channel
  const location = delivery.location
  const variant = PRODUCT_CREATE_FORM_DEFAULTS.variants![0]
  const values = {
    ...PRODUCT_CREATE_FORM_DEFAULTS,
    title,
    description: answers.description.trim(),
    sales_channels: channel
      ? [{ id: channel.id, name: channel.name ?? "" }]
      : [],
    variants: [
      {
        ...variant,
        sku: answers.sku.trim(),
        manage_inventory: answers.trackStock,
        prices: { [currency]: typedPrice },
      },
    ],
  } as ProductCreateSchemaType

  return {
    input: {
      payload: toCreateProductPayload(values, {
        // A draft: the publish step publishes it.
        status: "draft",
        uploadedMedia: thumbnail ? [{ url: thumbnail, isThumbnail: true }] : [],
        regionsCurrencyMap: {},
      }),
      stock:
        quantity !== null && location
          ? {
              locationId: location.id,
              entries: [{ variant_rank: variant.variant_rank, quantity }],
            }
          : undefined,
    },
    // Tracked, with nowhere to record it yet.
    pendingStock: quantity !== null && !location ? quantity : null,
  }
}

const WIZARD_LISTING_KEY = ["launch-wizard", "listing"] as const
const WIZARD_CONTINUE_KEY = ["launch-wizard", "continue"] as const

const StepButtons = ({
  onBack,
  backDisabled,
  children,
}: {
  onBack?: () => void
  backDisabled?: boolean
  children: React.ReactNode
}) => (
  <div className="mt-6 flex justify-between">
    {onBack ? (
      <Button variant="secondary" onClick={onBack} disabled={backDisabled}>
        <ArrowLeft className="mr-2" />
        Back
      </Button>
    ) : (
      <span />
    )}
    {children}
  </div>
)

type ListingStepProps = {
  sellingType: SellingType | null
  /** The product this step already created, when the vendor has come back. */
  existing: WizardProduct | null
  initial?: Partial<ListingAnswers>
  /** A photo chosen before the step rendered: specs have no file input. */
  initialPhoto?: File | null
  /** Called once the backend has created the draft. */
  onCreated: (product: WizardProduct) => void | Promise<void>
  /** Go on with the product already created. */
  onContinue: () => void | Promise<void>
  /** Forget the product already created and make another. */
  onStartOver: () => void
  onBack: () => void
}

export const ListingStep = ({
  sellingType,
  existing,
  initial,
  initialPhoto = null,
  onCreated,
  onContinue,
  onStartOver,
  onBack,
}: ListingStepProps) => {
  const [answers, setAnswers] = useState<ListingAnswers>({
    ...defaultListingAnswers(sellingType),
    ...initial,
  })
  const [photo, setPhoto] = useState<File | null>(initialPhoto)
  const [advanced, setAdvanced] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const set = <K extends keyof ListingAnswers>(key: K, value: ListingAnswers[K]) =>
    setAnswers((before) => ({ ...before, [key]: value }))

  // The store's sales channel, and where stock is held if anywhere yet.
  const { data: delivery, isPending: isDeliveryPending } = useDeliverySetup()
  const createProduct = useCreateProductWithStock()
  // One mutation for the photo upload, the product and its stock, so one key
  // covers the whole press.
  const create = useMutation({
    mutationKey: WIZARD_LISTING_KEY,
    mutationFn: async (separate: boolean) => {
      let thumbnail: string | undefined
      if (photo) {
        const uploaded = await uploadFilesQuery([{ file: photo }])
        thumbnail = uploaded?.files?.[0]?.url
        if (!thumbnail) {
          throw new Error("The photo was not saved. Remove it or try again.")
        }
      }
      const asked = listingRequestFrom(answers, { delivery, thumbnail })
      if ("problem" in asked) {
        throw new Error(asked.problem)
      }
      const created = await createProduct.mutateAsync({ ...asked.input, separate })
      return { created, pendingStock: asked.pendingStock }
    },
  })
  const { pending, isBusyNow } = useIsBusy(WIZARD_LISTING_KEY)
  // A product the store already has under this listing's handle, which is
  // not what the vendor entered (another tab, an earlier press): nothing is
  // adopted, and the vendor chooses. Read from the mutation cache, so the
  // choice outlives a re-render of the step.
  const client = useQueryClient()
  const listingErrors = useMutationState({
    filters: { mutationKey: WIZARD_LISTING_KEY },
    select: (mutation) => mutation.state.error,
  })
  const lastError = listingErrors[listingErrors.length - 1]
  const similar = lastError instanceof SimilarProductExists ? lastError : null
  const forgetSimilar = () => {
    const cache = client.getMutationCache()
    for (const mutation of cache.findAll({ mutationKey: WIZARD_LISTING_KEY })) {
      cache.remove(mutation)
    }
  }

  const submit = async (separate = false) => {
    if (isBusyNow()) return
    const asked = listingRequestFrom(answers, { delivery })
    if ("problem" in asked) {
      setProblem(asked.problem)
      toast.error(asked.problem)
      return
    }
    setProblem(null)
    try {
      const { created, pendingStock } = await create.mutateAsync(separate)
      const product = created.product
      toast.success(`${product.title} is saved as a draft`)
      if (created.stockError) {
        toast.error("Its stock was not recorded", {
          description: backendMessage(created.stockError, "Unknown error"),
        })
      }
      await onCreated({
        id: product.id,
        title: product.title,
        // Not recorded, for either reason: the delivery step records it.
        pendingStock: created.stockError
          ? Number(answers.quantity)
          : pendingStock,
      })
    } catch (e) {
      if (e instanceof SimilarProductExists) {
        // Shown below with the two choices.
        return
      }
      // The backend's own words: a listing type the playbook does not allow
      // is refused with the types it does.
      const message = backendMessage(e, "The listing could not be created.")
      setProblem(message)
      toast.error("The listing was not created", { description: message })
    }
  }

  if (existing) {
    return (
      <div>
        <Heading level="h1">Your first listing</Heading>
        <Alert variant="success" className="mt-4">
          {existing.title} is saved as a draft. Buyers cannot see it until you
          publish it, in the last step.
        </Alert>
        <Text className="text-ui-fg-subtle mt-3">
          To change it, open it in{" "}
          <a className="text-ui-fg-interactive" href={`/products/${existing.id}`}>
            Products
          </a>
          .
        </Text>
        <StepButtons onBack={onBack}>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onStartOver}>
              Make a different listing
            </Button>
            <Button onClick={() => void onContinue()}>
              Continue
              <ArrowRight className="ml-2" />
            </Button>
          </div>
        </StepButtons>
      </div>
    )
  }

  return (
    <div>
      <Heading level="h1">Your first listing</Heading>
      <Text className="text-ui-fg-subtle mt-1">
        Just the essentials. This saves a draft product in your store, which
        you publish in the last step and can edit in Products at any time.
      </Text>
      <div className="mt-6 grid grid-cols-1 gap-3">
        <div>
          <Label htmlFor="lw-title">Title</Label>
          <Input
            id="lw-title"
            value={answers.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="lw-price">
            Price ({listingCurrency(delivery)?.toUpperCase() ?? "…"})
          </Label>
          <Input
            id="lw-price"
            type="number"
            min="0"
            step="0.01"
            value={answers.price}
            onChange={(e) => set("price", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="lw-desc">Description</Label>
          <Textarea
            id="lw-desc"
            rows={3}
            value={answers.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="lw-photo">Photo</Label>
          <input
            id="lw-photo"
            type="file"
            accept="image/*"
            className="txt-compact-small block w-full"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          <Text size="small" className="text-ui-fg-subtle mt-1">
            {photo
              ? `${photo.name} will be uploaded with the listing.`
              : "Optional. You can add more photos in Products."}
          </Text>
        </div>
        <div>
          <Label htmlFor="lw-stock">Stock</Label>
          <Select
            value={answers.trackStock ? "track" : "untracked"}
            onValueChange={(value) => set("trackStock", value === "track")}
          >
            <Select.Trigger id="lw-stock">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="track">I have a limited number</Select.Item>
              <Select.Item value="untracked">
                Don't track stock: it can always be bought
              </Select.Item>
            </Select.Content>
          </Select>
          {answers.trackStock ? (
            <div className="mt-3">
              <Label htmlFor="lw-quantity">How many do you have?</Label>
              <Input
                id="lw-quantity"
                type="number"
                min="1"
                step="1"
                value={answers.quantity}
                onChange={(e) => set("quantity", e.target.value)}
              />
              <Text size="small" className="text-ui-fg-subtle mt-1">
                {isDeliveryPending
                  ? "Checking where your stock is held…"
                  : delivery?.location
                    ? `Held at ${delivery.location.name}.`
                    : "You have no stock location yet. The next step sets one up, and this number is recorded there."}
              </Text>
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        className="text-ui-fg-interactive mt-4 text-sm"
        onClick={() => setAdvanced((v) => !v)}
      >
        {advanced ? "Hide" : "Show"} advanced fields
      </button>
      {advanced ? (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="lw-sku">SKU</Label>
            <Input
              id="lw-sku"
              value={answers.sku}
              onChange={(e) => set("sku", e.target.value)}
            />
          </div>
        </div>
      ) : null}

      {problem ? (
        <Alert variant="error" className="mt-4">
          {problem}
        </Alert>
      ) : null}
      {similar ? (
        <Alert variant="warning" className="mt-4">
          {similar.message} Use that product as it is, or make a separate
          listing from what you entered?
          <div className="mt-3 flex gap-2">
            <Button
              size="small"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                const chosen = similar.product
                forgetSimilar()
                toast.info(`${chosen.title} is used as it is`, {
                  description:
                    "Its price and stock were not changed. Check them in Products.",
                })
                void onCreated({ id: chosen.id, title: chosen.title, pendingStock: null })
              }}
            >
              Use {similar.product.title}
            </Button>
            <Button
              size="small"
              disabled={pending}
              onClick={() => void submit(true)}
            >
              Make a separate listing
            </Button>
          </div>
        </Alert>
      ) : null}

      <StepButtons onBack={onBack} backDisabled={pending}>
        <Button
          onClick={() => void submit()}
          disabled={pending || isDeliveryPending}
          isLoading={pending}
        >
          Save draft and continue
          <ArrowRight className="ml-2" />
        </Button>
      </StepButtons>
    </div>
  )
}

/**
 * What the delivery form starts with. Nothing is ticked for the vendor. For
 * something that is not shipped, the flat-rate option is pre-named and priced
 * at 0, because checkout asks every buyer for a delivery choice whatever is
 * sold (Mercur wants a shipping method per seller).
 */
export const deliveryAnswersFor = (
  sellingType: SellingType | null
): Partial<DeliveryAnswers> =>
  sellingType === "digital" ||
  sellingType === "service" ||
  sellingType === "event_class"
    ? { shippingName: "No shipping needed", shippingPrice: "0" }
    : {}

type DeliveryStepProps = {
  sellingType: SellingType | null
  product: WizardProduct | null
  /** The quantity entered at the listing step has been recorded. */
  onStockRecorded: (product: WizardProduct) => void
  onContinue: () => void | Promise<void>
  onBack: () => void
}

export const DeliveryStep = ({
  sellingType,
  product,
  onStockRecorded,
  onContinue,
  onBack,
}: DeliveryStepProps) => {
  const { data: setup } = useSellingSetup()
  const recordStock = useRecordStock()
  const next = useMutation({
    mutationKey: WIZARD_CONTINUE_KEY,
    mutationFn: async () => {
      const location = setup?.delivery.location
      // The number the vendor gave at the listing step, now that there is a
      // place to hold it.
      if (product?.pendingStock && location) {
        await recordStock.mutateAsync({
          productId: product.id,
          locationId: location.id,
          stock: [{ variant_rank: 0, quantity: product.pendingStock }],
        })
        onStockRecorded({ ...product, pendingStock: null })
      }
      await onContinue()
    },
  })
  const { pending, isBusyNow } = useIsBusy(WIZARD_CONTINUE_KEY)
  const ready = Boolean(setup?.delivery.ready)

  const goOn = async () => {
    if (isBusyNow() || !ready) return
    try {
      await next.mutateAsync()
    } catch (e) {
      toast.error("Your stock was not recorded", {
        description: backendMessage(e, "Unknown error"),
      })
    }
  }

  const notShipped =
    sellingType === "digital" ||
    sellingType === "service" ||
    sellingType === "event_class"

  return (
    <div>
      <Heading level="h1">Delivery</Heading>
      <Text className="text-ui-fg-subtle mt-1">
        {notShipped
          ? "Nothing here is shipped, but checkout asks every buyer for a delivery choice and an order cannot be placed without one. Offer a free one: tick the flat rate below, leave its price at 0, and name it so buyers understand."
          : "Say where your goods are and how buyers get them. A buyer cannot check out until both are here."}
      </Text>
      <div className="mt-6">
        <DeliverySetupForm initial={deliveryAnswersFor(sellingType)} />
      </div>
      {product?.pendingStock ? (
        <Text size="small" className="text-ui-fg-subtle mt-4">
          Continuing records the {product.pendingStock} of {product.title} you
          have at {setup?.delivery.location?.name ?? "your stock location"}.
        </Text>
      ) : null}
      <StepButtons onBack={onBack} backDisabled={pending}>
        <div className="flex flex-col items-end gap-1">
          <Button
            onClick={goOn}
            disabled={!ready || pending}
            isLoading={pending}
          >
            Continue
            <ArrowRight className="ml-2" />
          </Button>
          {ready ? null : (
            <Text size="small" className="text-ui-fg-subtle">
              Save pickup or shipping above to continue.
            </Text>
          )}
        </div>
      </StepButtons>
    </div>
  )
}

type PublishStepProps = {
  /** The product the listing step created, if this browser remembers it. */
  product: WizardProduct | null
  /** Called once the backend says the product is published and recorded. */
  onPublished: (state: unknown, product: { id: string; title?: string }) => void
  /** Back to the listing step, for a store with no product. */
  onMakeListing: () => void
  /** Forget the remembered product and choose among the store's instead. */
  onForget: () => void
  onBack: () => void
}

export const PublishStep = ({
  product,
  onPublished,
  onMakeListing,
  onForget,
  onBack,
}: PublishStepProps) => {
  // Only when the wizard's own product is not known: the store's products to
  // choose from. Never a typed id.
  const { products, isPending: isProductsPending } = useProducts(undefined, {
    enabled: !product,
  })
  const [chosen, setChosen] = useState<string>("")
  const [problem, setProblem] = useState<string | null>(null)
  const { data: setup, isPending: isSetupPending } = useSellingSetup()
  const publish = usePublishFirstListing()
  const { pending, isBusyNow } = useIsBusy(sellingSetupMutationKeys.publish)

  const candidates = product
    ? [product]
    : (products ?? []).map((p) => ({ id: p.id, title: p.title ?? p.id }))
  const target =
    candidates.find((candidate) => candidate.id === chosen) ??
    (candidates.length === 1 ? candidates[0] : undefined)
  const deliveryReady = Boolean(setup?.delivery.ready)

  const submit = async () => {
    if (isBusyNow() || !target || !deliveryReady) return
    setProblem(null)
    try {
      const { state, product: published } = await publish.mutateAsync(target.id)
      toast.success(`${published.title ?? target.title} is published`)
      onPublished(state, published)
    } catch (e) {
      const message = backendMessage(e, "The listing could not be published.")
      setProblem(message)
      toast.error("The listing was not published", { description: message })
    }
  }

  if (!product && isProductsPending) {
    return <Text className="text-ui-fg-subtle">Loading your products…</Text>
  }

  if (candidates.length === 0) {
    return (
      <div>
        <Heading level="h1">Publish</Heading>
        <Alert variant="warning" className="mt-4">
          Your store has no product to publish yet.
        </Alert>
        <StepButtons onBack={onBack}>
          <Button onClick={onMakeListing}>Make your first listing</Button>
        </StepButtons>
      </div>
    )
  }

  return (
    <div>
      <Heading level="h1">Publish</Heading>
      <Text className="text-ui-fg-subtle mt-1">
        Publishing makes the listing visible to buyers in the storefront.
      </Text>

      {product ? (
        <div className="bg-ui-bg-subtle mt-4 rounded-md p-4">
          <Text className="font-medium">{product.title}</Text>
          <Text size="small" className="text-ui-fg-subtle">
            The draft you made in this wizard.
          </Text>
        </div>
      ) : (
        <div className="mt-4">
          <Label htmlFor="lw-publish-product">Which product?</Label>
          <Select value={target?.id ?? ""} onValueChange={setChosen}>
            <Select.Trigger id="lw-publish-product">
              <Select.Value placeholder="Choose one of your products" />
            </Select.Trigger>
            <Select.Content>
              {candidates.map((candidate) => (
                <Select.Item key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      )}

      {isSetupPending ? null : deliveryReady ? null : (
        <Alert variant="warning" className="mt-4">
          Buyers could not check out yet: your store has no pickup or shipping
          option on a stock location linked to your sales channel. Go back to
          Delivery and save one before publishing.
        </Alert>
      )}
      {problem ? (
        <Alert variant="error" className="mt-4">
          {problem}
          {product ? (
            <>
              {" "}
              <button
                type="button"
                className="text-ui-fg-interactive underline"
                onClick={onForget}
              >
                Choose from your products instead
              </button>
            </>
          ) : null}
        </Alert>
      ) : null}

      <StepButtons onBack={onBack} backDisabled={pending}>
        <Button
          onClick={submit}
          disabled={pending || !target || !deliveryReady}
          isLoading={pending}
        >
          Publish{target ? ` ${target.title}` : ""}
        </Button>
      </StepButtons>
    </div>
  )
}

/** What still stops a buyer, in the order to fix it. */
export const blockersOf = (
  setup: SellingSetup
): Array<{ text: string; to: string; action: string }> => {
  const blockers: Array<{ text: string; to: string; action: string }> = []
  const { delivery, listing } = setup
  if (!delivery.ready) {
    blockers.push({
      text: !delivery.location
        ? "Your store has no stock location and no pickup or shipping option."
        : !delivery.locationLinked
          ? `${delivery.location.name} is not linked to your sales channel.`
          : delivery.unoffered.length > 0
            ? `No buyer is offered your pickup or shipping: ${delivery.unoffered
                .map(unofferedReason)
                .join(" ")}`
            : `${delivery.location.name} has no pickup or shipping option.`,
      to: "/delivery-setup",
      action: "Set up pickup or shipping",
    })
  }
  if (!listing.buyable) {
    if (listing.needsPrice) {
      blockers.push({
        text: `${listing.needsPrice.title} has no price in ${listing.currencies.join(" or ")}, the currency buyers pay in.`,
        to: `/products/${listing.needsPrice.id}/prices`,
        action: "Set its price",
      })
    }
    if (listing.needsStock) {
      blockers.push({
        text: `${listing.needsStock.title} tracks stock and has none.`,
        to: `/products/${listing.needsStock.id}/stock`,
        action: "Enter its stock",
      })
    } else if (listing.needsPrice) {
      // Said above.
    } else if (listing.draft) {
      blockers.push({
        text: `${listing.draft.title} is still a draft.`,
        to: `/products/${listing.draft.id}`,
        action: "Open it to publish",
      })
    } else if (delivery.ready) {
      blockers.push({
        text: "Your store has no published product.",
        to: "/products/create",
        action: "Add a product",
      })
    }
  }
  return blockers
}

/**
 * The wizard's last screen. "You're live!" is said only when the store, read
 * back from the backend, has a published product a buyer could check out
 * with; otherwise it says what is published and what still stops a buyer.
 */
export const PublishedScreen = () => {
  const { data: setup, isPending, isError, refetch } = useSellingSetup()

  if (isPending) {
    return (
      <div className="text-center">
        <Text className="text-ui-fg-subtle">Checking your store…</Text>
      </div>
    )
  }

  const blockers = setup ? blockersOf(setup) : []
  const live = Boolean(setup?.ready)

  return (
    <div className="text-center">
      {live ? (
        <>
          <CheckCircleSolid className="text-ui-tag-green-icon mx-auto mb-3 h-12 w-12" />
          <Heading level="h1">You're live!</Heading>
          <Text className="text-ui-fg-subtle mt-2">
            {setup?.listing.buyable?.title} is published, and buyers can check
            out with {setup?.delivery.options.map((o) => o.name).join(" or ")}.
            Time to share it.
          </Text>
        </>
      ) : (
        <>
          <Heading level="h1">Your listing is published</Heading>
          {isError || !setup ? (
            <>
              <Alert variant="warning" className="mt-4 text-left">
                We could not check whether buyers can check out from your store
                yet.
              </Alert>
              <Button
                variant="secondary"
                size="small"
                className="mt-3"
                onClick={() => refetch()}
              >
                Check again
              </Button>
            </>
          ) : (
            <Alert variant="warning" className="mt-4 text-left">
              Buyers cannot buy it yet.
              <ul className="mt-2 list-disc pl-5">
                {blockers.map((blocker) => (
                  <li key={blocker.to}>
                    {blocker.text}{" "}
                    <a className="text-ui-fg-interactive" href={blocker.to}>
                      {blocker.action}
                    </a>
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </>
      )}
      <div className="mt-6 flex justify-center gap-2">
        <Button
          variant="secondary"
          onClick={() => (window.location.href = "/dashboard")}
        >
          Go to dashboard
        </Button>
        <Button onClick={() => (window.location.href = "/products")}>
          Manage products
        </Button>
      </div>
    </div>
  )
}
