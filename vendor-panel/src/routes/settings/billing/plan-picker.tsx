import { useState } from "react"
import { Badge, Button, Text, toast } from "@medusajs/ui"

import {
  useChangeVendorPlan,
  useVendorPlanChangePreview,
  type AvailablePlan,
  type VendorPlanChangePreview,
  type VendorPlanSummary,
} from "../../../hooks/api/vendor-plan"
import {
  changeOutcome,
  describeChangeTerms,
  describePlanPrice,
  formatPlanDate,
  newPanelIdempotencyKey,
} from "./plan-terms"

/**
 * The plans this vendor may move to, straight from `available_plans` on
 * `GET /vendor/plan/me`. The backend decides which plans are offered (the
 * FF_ALL_ACCESS_PLAN_V1 ladder or the original one), so the panel needs no
 * flag of its own and can never offer a plan the change route would refuse.
 *
 * The confirm step's terms come from `GET /vendor/plan/preview` for THIS
 * seller, never from the catalog row: the catalog says "30-day trial", but a
 * vendor who already had the all_access trial gets none, and a move to a
 * cheaper plan lands at the end of the paid period, not today. The confirm
 * step is the vendor's approval of a recurring charge, so it must state the
 * charge they will actually get.
 */

/** Operator-assigned plans are changed by the operator, not from this screen. */
const OPERATOR_PLAN_CODES = new Set(["internal"])

type Props = {
  currentPlan: VendorPlanSummary | undefined
  availablePlans: AvailablePlan[]
}

type Confirming = { code: string; key: string }

const ConfirmTerms = ({
  plan,
  confirming,
  isPending,
  onConfirm,
  onCancel,
}: {
  plan: AvailablePlan
  confirming: Confirming
  isPending: boolean
  onConfirm: (preview: VendorPlanChangePreview) => void
  onCancel: () => void
}) => {
  const {
    data: preview,
    isPending: previewPending,
    isError,
    error,
  } = useVendorPlanChangePreview(confirming.code)

  return (
    <div className="flex flex-col gap-y-2 rounded-md bg-ui-bg-subtle p-3">
      {previewPending ? (
        <Text size="xsmall" className="text-ui-fg-subtle">
          Checking the terms for {plan.display_name}…
        </Text>
      ) : isError || !preview ? (
        <Text size="xsmall" className="text-ui-fg-error">
          {error instanceof Error
            ? error.message
            : "Could not load the terms for this plan."}
        </Text>
      ) : (
        <Text size="xsmall">{describeChangeTerms(preview)}</Text>
      )}
      <div className="flex gap-x-2">
        <Button
          size="small"
          variant="primary"
          isLoading={isPending}
          disabled={!preview || previewPending || isError}
          onClick={() => preview && onConfirm(preview)}
        >
          Confirm
        </Button>
        <Button
          size="small"
          variant="transparent"
          disabled={isPending}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

export const PlanPicker = ({ currentPlan, availablePlans }: Props) => {
  const { mutateAsync: changePlan, isPending } = useChangeVendorPlan()
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [deferredNote, setDeferredNote] = useState<string | null>(null)

  if (availablePlans.length === 0) return null

  const currentCode = currentPlan?.code ?? "free"

  if (OPERATOR_PLAN_CODES.has(currentCode)) {
    return (
      <Text size="xsmall" className="text-ui-fg-subtle">
        Your plan is assigned by the Free Black Market team. Contact support to
        change it.
      </Text>
    )
  }

  const submit = async (
    plan: AvailablePlan,
    attempt: Confirming,
    preview: VendorPlanChangePreview
  ) => {
    try {
      const result = await changePlan({
        plan_code: plan.code,
        idempotency_key: attempt.key,
        // The vendor has just read the renewal terms above and pressed
        // Confirm: that is the affirmative approval the backend records.
        ...(preview.renews ? { auto_renew_consent: true } : {}),
      })
      setConfirming(null)
      const outcome = changeOutcome(plan.display_name, result)
      switch (outcome.kind) {
        case "deferred":
          setDeferredNote(outcome.message)
          toast.success(`${plan.display_name} scheduled`)
          break
        case "unchanged":
          toast.info(outcome.message)
          break
        default:
          setDeferredNote(null)
          toast.success(outcome.message)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not change plan"
      toast.error(message)
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Text size="small" weight="plus">
        Available plans
      </Text>

      {currentPlan?.status === "trialing" && currentPlan.trial_ends_at ? (
        <Text size="xsmall" className="text-ui-fg-subtle">
          Your trial ends on {formatPlanDate(currentPlan.trial_ends_at)}. The
          first charge is raised that day unless you change plan before then.
        </Text>
      ) : null}

      {deferredNote ? (
        <Text size="xsmall" className="text-ui-fg-subtle">
          {deferredNote}
        </Text>
      ) : null}

      <div className="flex flex-col">
        {availablePlans.map((plan) => {
          const isCurrent = plan.code === currentCode
          const isPendingTarget = currentPlan?.pending_plan_code === plan.code
          const isConfirming = confirming?.code === plan.code

          return (
            <div
              key={plan.code}
              className="flex flex-col gap-y-2 border-b border-ui-border-base py-3 last:border-b-0"
            >
              <div className="flex items-start justify-between gap-x-4">
                <div className="flex flex-col">
                  <div className="flex items-center gap-x-2">
                    <Text size="small" weight="plus">
                      {plan.display_name}
                    </Text>
                    {isCurrent ? (
                      <Badge size="2xsmall" color="green">
                        Current
                      </Badge>
                    ) : null}
                    {isPendingTarget ? (
                      <Badge size="2xsmall" color="orange">
                        Scheduled
                      </Badge>
                    ) : null}
                  </div>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {plan.description}
                  </Text>
                </div>
                <div className="flex flex-col items-end">
                  <Text size="small" weight="plus">
                    {describePlanPrice(plan)}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {plan.platform_fee_percent != null
                      ? `${plan.platform_fee_percent}% commission`
                      : "Standard commission"}
                  </Text>
                </div>
              </div>

              {!isCurrent && !isConfirming ? (
                <div>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={isPending || isPendingTarget}
                    onClick={() =>
                      setConfirming({
                        code: plan.code,
                        key: newPanelIdempotencyKey(),
                      })
                    }
                  >
                    {isPendingTarget ? "Scheduled" : `Switch to ${plan.display_name}`}
                  </Button>
                </div>
              ) : null}

              {isConfirming && confirming ? (
                <ConfirmTerms
                  plan={plan}
                  confirming={confirming}
                  isPending={isPending}
                  onConfirm={(preview) => submit(plan, confirming, preview)}
                  onCancel={() => setConfirming(null)}
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
