/**
 * manageSubscriptionWorkflow's two gates, run as plain predicates (the SDK is
 * stubbed to capture them): a cancel that ENDED the subscription revokes and
 * lapses Blackout exactly as before; a cancel that started or continued grace
 * (FF_CONSUMER_SUBSCRIPTIONS_V1) does neither — access continues until grace
 * ends.
 */
type Predicate = (data: {
  input: { action: string }
  subscription: { status?: string } | undefined
}) => boolean

const predicates: Record<string, Predicate> = {}
const stepCalls: string[] = []

jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createWorkflow: (name: unknown, composerFn: unknown) => ({ name, composerFn }),
  createStep: jest.fn(),
  StepResponse: class {},
  WorkflowResponse: class WorkflowResponse {
    constructor(public result: unknown) {}
  },
  when: (name: string, _data: unknown, predicate: Predicate) => {
    predicates[name] = predicate
    return { then: (fn: () => unknown) => fn() }
  },
}))
jest.mock("../steps/plan-subscription-cancel", () => ({
  planSubscriptionCancelStep: () => (stepCalls.push("plan"), { mode: "legacy" }),
}))
jest.mock("../steps/update-subscription", () => ({
  updateSubscriptionStep: (args: { cancel_plan?: unknown }) => {
    stepCalls.push(`update:${args.cancel_plan ? "with-plan" : "no-plan"}`)
    return { subscription: { id: "sub_1" } }
  },
}))
jest.mock("../steps/revoke-subscription-entitlements", () => ({
  revokeSubscriptionEntitlementsStep: () => stepCalls.push("revoke"),
}))
jest.mock("../steps/emit-subscription-state", () => ({
  emitSubscriptionStateStep: () => stepCalls.push("emit-blackout"),
}))
// Loading the real core-flows against the stubbed SDK above fails; the
// workflow only needs emitEventStep(...).config(...).
jest.mock("@medusajs/medusa/core-flows", () => ({
  emitEventStep: () => ({ config: () => stepCalls.push("emit-canceled") }),
}))

import { PHASE0_FEATURE_FLAGS } from "../../../shared/feature-flags"
import { manageSubscriptionWorkflow } from "../workflows/manage-subscription"

describe("manageSubscriptionWorkflow gates", () => {
  beforeAll(() => {
    ;(manageSubscriptionWorkflow as unknown as {
      composerFn: (i: { subscription_id: string; action: string }) => unknown
    }).composerFn({ subscription_id: "sub_1", action: "cancel" })
  })

  it("plans before it writes, and hands the plan to the write", () => {
    expect(stepCalls.indexOf("plan")).toBeLessThan(stepCalls.indexOf("update:with-plan"))
  })

  const revoke = (action: string, status?: string) =>
    predicates["revoke-entitlements-on-cancel"]({ input: { action }, subscription: { status } })
  const emit = (action: string, status?: string) =>
    predicates["emit-blackout-subscription-state"]({ input: { action }, subscription: { status } })

  it("a cancel that ended the subscription (flag off / no grace) revokes and lapses, as before", () => {
    expect(revoke("cancel", "canceled")).toBe(true)
    expect(emit("cancel", "canceled")).toBe(true)
  })

  it("a cancel that started or continued grace keeps access", () => {
    expect(revoke("cancel", "past_due")).toBe(false)
    expect(emit("cancel", "past_due")).toBe(false)
  })

  it("Black Mask hears `subscription.canceled` only when the cancel ended the subscription", () => {
    const flag = PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1
    const canceled = (action: string, status?: string) =>
      predicates["emit-subscription-canceled-when"]({ input: { action }, subscription: { status } })
    process.env[flag] = "true"
    try {
      expect(canceled("cancel", "canceled")).toBe(true)
      // Grace keeps a paid-through member provisioned; grace-lifecycle.ts
      // sends grace_started / read_only instead.
      expect(canceled("cancel", "past_due")).toBe(false)
      expect(canceled("pause", "paused")).toBe(false)
    } finally {
      delete process.env[flag]
    }
    expect(canceled("cancel", "canceled")).toBe(false)
  })

  it("pause and resume never revoke and always mirror to Blackout, as before", () => {
    expect(revoke("pause", "paused")).toBe(false)
    expect(emit("pause", "paused")).toBe(true)
    expect(revoke("resume", "active")).toBe(false)
    expect(emit("resume", "active")).toBe(true)
  })
})
