import { useNavigate } from "react-router-dom"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"

import {
  daysRemaining,
  interpretAddonPurchase,
  usePurchaseAddon,
  useVendorAddons,
  type VendorAddon,
} from "../../../hooks/api/vendor-addons"
import { SingleColumnPageSkeleton } from "../../../components/common/skeleton"

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100)

/**
 * Feature keys are a billing vocabulary, not a UI one, so they are labelled
 * rather than shown raw. An unmapped key falls back to its own name instead of
 * being hidden — a pack that silently listed nothing would be worse than one
 * listing something ugly.
 */
const FEATURE_LABELS: Record<string, string> = {
  "vendor.quests": "Readiness quests",
  "vendor.nursery": "Nursery management",
  "vendor.production_ledger": "Production ledger",
  "vendor.pos": "Point of sale",
  "vendor.invoicing": "Invoicing",
  "vendor.pick_pack": "Pick & pack",
  "vendor.embed": "Embedded storefront",
  "vendor.document_vault": "Document vault",
  "vendor.channel_sync": "Channel sync",
}

const AddonCard = ({
  addon,
  purchasable,
  onBuy,
  busy,
}: {
  addon: VendorAddon
  purchasable: boolean
  onBuy: (code: string) => void
  busy: boolean
}) => {
  const left = daysRemaining(addon.owned)

  return (
    <Container className="flex flex-col gap-y-4">
      <div className="flex items-start justify-between gap-x-4">
        <div className="flex flex-col gap-y-1">
          <div className="flex items-center gap-x-2">
            <Heading level="h3">{addon.display_name}</Heading>
            {addon.owned.active ? (
              <Badge size="2xsmall" color="green">
                Active
              </Badge>
            ) : null}
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            {addon.description}
          </Text>
        </div>
        <div className="flex flex-col items-end whitespace-nowrap">
          <Text size="small" weight="plus">
            {money(addon.price_amount, addon.currency_code)}
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {addon.duration_days} days
          </Text>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {addon.feature_keys.map((key) => (
          <Badge key={key} size="2xsmall">
            {FEATURE_LABELS[key] ?? key}
          </Badge>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Text size="xsmall" className="text-ui-fg-subtle">
          {left !== null
            ? `${left} day${left === 1 ? "" : "s"} left — buying again extends it`
            : "Not active"}
        </Text>
        {purchasable ? (
          <Button
            size="small"
            variant={addon.owned.active ? "secondary" : "primary"}
            disabled={busy}
            onClick={() => onBuy(addon.code)}
          >
            {addon.owned.active ? "Extend" : "Buy"}
          </Button>
        ) : null}
      </div>
    </Container>
  )
}

export const AddonSettings = () => {
  const navigate = useNavigate()
  const { addons, purchasable, isPending } = useVendorAddons()
  const { mutate: purchase, isPending: buying } = usePurchaseAddon()

  const onBuy = (code: string) => {
    purchase(
      { code },
      {
        onSuccess: (result) => {
          const feedback = interpretAddonPurchase(result)
          if (feedback.tone === "success") {
            toast.success(feedback.message)
            return
          }
          if (feedback.needsPaymentMethod) {
            // Not a failure to retry — send them where the fix is.
            toast.info(feedback.message)
            navigate("/settings/billing")
            return
          }
          if (feedback.tone === "info") {
            toast.info(feedback.message)
            return
          }
          toast.error(feedback.message)
        },
        onError: (err) => {
          toast.error(err.message || "Failed to purchase add-on")
        },
      }
    )
  }

  if (isPending) {
    return (
      <SingleColumnPageSkeleton
        sections={3}
        showJSON={false}
        showMetadata={false}
      />
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="flex flex-col gap-y-2">
        <Heading level="h2">Add-ons</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Buy individual capabilities for a fixed period without changing your
          plan. Buying an add-on you already hold extends it rather than
          restarting it.
        </Text>
        {!purchasable ? (
          <Text size="small" className="text-ui-fg-subtle">
            Self-serve checkout is not enabled on this marketplace yet — the
            team can arrange add-ons with you directly.
          </Text>
        ) : null}
      </Container>

      {addons.length === 0 ? (
        <Container>
          <Text size="small" className="text-ui-fg-subtle">
            No add-ons are available right now.
          </Text>
        </Container>
      ) : (
        addons.map((addon) => (
          <AddonCard
            key={addon.code}
            addon={addon}
            purchasable={purchasable}
            onBuy={onBuy}
            busy={buying}
          />
        ))
      )}
    </div>
  )
}
