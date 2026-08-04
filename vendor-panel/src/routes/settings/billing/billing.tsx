import { useState } from "react"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"

import { useVendorPlan } from "../../../hooks/api/vendor-plan"
import {
  useVendorBilling,
  type VendorCharge,
  type VendorChargeStatus,
} from "../../../hooks/api/vendor-billing"
import {
  describeUsage,
  useVendorUsage,
  type ResourceUsage,
} from "../../../hooks/api/vendor-usage"
import { SingleColumnPageSkeleton } from "../../../components/common/skeleton"
import { PaymentMethodForm } from "./payment-method-form"

const money = (amount: number, currency: string | null) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  }).format(amount / 100)

const STATUS_TONE: Record<
  VendorChargeStatus,
  "green" | "orange" | "red" | "grey"
> = {
  paid: "green",
  processing: "orange",
  pending: "orange",
  failed: "red",
  void: "grey",
  refunded: "grey",
}

const ChargeRow = ({ charge }: { charge: VendorCharge }) => (
  <div className="flex items-center justify-between border-b border-ui-border-base py-3 last:border-b-0">
    <div className="flex flex-col">
      <Text size="small" weight="plus">
        {charge.description}
      </Text>
      {charge.failure_reason ? (
        <Text size="xsmall" className="text-ui-fg-error">
          {charge.failure_reason}
        </Text>
      ) : charge.period_end ? (
        <Text size="xsmall" className="text-ui-fg-subtle">
          Through {new Date(charge.period_end).toLocaleDateString()}
        </Text>
      ) : null}
    </div>
    <div className="flex items-center gap-x-3">
      <Text size="small">{money(charge.amount, charge.currency_code)}</Text>
      <Badge size="2xsmall" color={STATUS_TONE[charge.status]}>
        {charge.status}
      </Badge>
    </div>
  </div>
)

const UsageRow = ({ resource }: { resource: ResourceUsage }) => {
  const display = describeUsage(resource)

  return (
    <div className="flex items-center justify-between border-b border-ui-border-base py-3 last:border-b-0">
      <div className="flex flex-col">
        <Text size="small">{resource.label}</Text>
        {display.hint ? (
          <Text
            size="xsmall"
            className={
              display.tone === "red" ? "text-ui-fg-error" : "text-ui-fg-subtle"
            }
          >
            {display.hint}
          </Text>
        ) : null}
      </div>
      <Badge size="2xsmall" color={display.tone}>
        {display.amount}
      </Badge>
    </div>
  )
}

export const BillingSettings = () => {
  const { plan, isPending: planPending } = useVendorPlan()
  const { resources: usage, allowances } = useVendorUsage()
  const {
    outstanding,
    charges,
    billingEnabled,
    hasPaymentMethod,
    isPending: billingPending,
    refetch,
  } = useVendorBilling()

  const [addingCard, setAddingCard] = useState(false)

  if (planPending || billingPending) {
    return <SingleColumnPageSkeleton sections={3} showJSON={false} showMetadata={false} />
  }

  return (
    <div className="flex flex-col gap-y-3">
      {/* Plan */}
      <Container className="flex flex-col gap-y-4">
        <div className="flex items-center justify-between">
          <Heading level="h2">Plan</Heading>
          <Badge size="2xsmall">{plan?.code ?? "free"}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Text size="small" className="text-ui-fg-subtle">
              Marketplace commission
            </Text>
            <Text size="small" weight="plus">
              {plan?.platform_fee_percent != null
                ? `${plan.platform_fee_percent}%`
                : "Standard"}
            </Text>
          </div>
          <div>
            <Text size="small" className="text-ui-fg-subtle">
              Status
            </Text>
            <Text size="small" weight="plus">
              {plan?.status ?? "active"}
            </Text>
          </div>
          {plan?.pending_plan_code ? (
            <div className="col-span-2">
              <Text size="xsmall" className="text-ui-fg-subtle">
                Changing to {plan.pending_plan_code}
                {plan.pending_effective_at
                  ? ` on ${new Date(plan.pending_effective_at).toLocaleDateString()}`
                  : ""}
              </Text>
            </div>
          ) : null}
        </div>
      </Container>

      {/* Usage against plan allowances. Rendered only once it has loaded —
          this is supplementary to billing, so it must not hold up the page or
          leave an empty shell if the usage read is slow or degraded. */}
      {usage.length > 0 || allowances.length > 0 ? (
        <Container className="flex flex-col gap-y-2">
          <Heading level="h2">Usage</Heading>
          {usage.length > 0 ? (
            <div className="flex flex-col">
              {usage.map((resource) => (
                <UsageRow key={resource.key} resource={resource} />
              ))}
            </div>
          ) : null}
          {allowances.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              {allowances.map((allowance) => (
                <Text
                  key={allowance.key}
                  size="xsmall"
                  className="text-ui-fg-subtle"
                >
                  {allowance.label}: {allowance.limit}
                </Text>
              ))}
            </div>
          ) : null}
        </Container>
      ) : null}

      {/* Payment method + balance */}
      <Container className="flex flex-col gap-y-4">
        <Heading level="h2">Payment</Heading>

        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <Text size="small" className="text-ui-fg-subtle">
              Outstanding balance
            </Text>
            <Text size="small" weight="plus">
              {outstanding.amount > 0
                ? money(outstanding.amount, outstanding.currency_code)
                : "Nothing due"}
            </Text>
          </div>
          <div className="flex flex-col items-end">
            <Text size="small" className="text-ui-fg-subtle">
              Payment method
            </Text>
            <Text size="small" weight="plus">
              {hasPaymentMethod ? "On file" : "None"}
            </Text>
          </div>
        </div>

        {!billingEnabled ? (
          <Text size="small" className="text-ui-fg-subtle">
            Self-serve payment is not enabled on this marketplace yet. Any
            charges shown here are recorded but not collected; the team will
            arrange billing with you directly.
          </Text>
        ) : addingCard ? (
          <PaymentMethodForm
            onCancel={() => setAddingCard(false)}
            onSaved={() => {
              setAddingCard(false)
              refetch()
            }}
          />
        ) : (
          <div>
            <Button
              size="small"
              variant="secondary"
              onClick={() => setAddingCard(true)}
            >
              {hasPaymentMethod ? "Update card" : "Add a card"}
            </Button>
          </div>
        )}
      </Container>

      {/* History */}
      <Container className="flex flex-col gap-y-2">
        <Heading level="h2">Charges</Heading>
        {charges.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No charges yet.
          </Text>
        ) : (
          <div className="flex flex-col">
            {charges.map((c) => (
              <ChargeRow key={c.id} charge={c} />
            ))}
          </div>
        )}
      </Container>
    </div>
  )
}
