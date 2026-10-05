// The three domain steps are replaced with no-op steps, so the real
// manageSubscriptionWorkflow composition (its `when` branches and the real
// core-flows emitEventStep) runs in-process against a fake event bus.
function mockNoopStep(id: string, output: (input: { subscription_id: string; action?: string }) => unknown) {
  const sdk = require("@medusajs/framework/workflows-sdk")
  return sdk.createStep(id, async (input: { subscription_id: string; action?: string }) => new sdk.StepResponse(output(input)))
}
jest.mock("../steps/update-subscription", () => ({
  updateSubscriptionStep: mockNoopStep("update-subscription-step", (i) => ({
    subscription: { id: i.subscription_id, status: i.action },
  })),
}))
jest.mock("../steps/emit-subscription-state", () => ({
  emitSubscriptionStateStep: mockNoopStep("emit-subscription-state-step", () => null),
}))
jest.mock("../steps/revoke-subscription-entitlements", () => ({
  revokeSubscriptionEntitlementsStep: mockNoopStep("revoke-subscription-entitlements", () => null),
}))

import { asValue } from "@medusajs/framework/awilix"
import { createMedusaContainer, Modules } from "@medusajs/framework/utils"
import { PHASE0_FEATURE_FLAGS } from "../../../shared/feature-flags"
import {
  manageSubscriptionWorkflow,
  shouldEmitSubscriptionCanceled,
  SUBSCRIPTION_CANCELED_EVENT,
} from "../workflows/manage-subscription"

/**
 * `subscription.canceled` exists only for the Black Mask provisioning channel,
 * so manageSubscriptionWorkflow publishes it only on cancel AND only while
 * FF_BLACK_MASK_PROVISIONING_V1 is on.
 */
const FLAG = PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1

afterEach(() => {
  delete process.env[FLAG]
})

function makeContainer() {
  const emitted: Array<{ name: string; data: unknown }> = []
  const eventBus = {
    emit: jest.fn(async (messages: Array<{ name: string; data: unknown }> | { name: string; data: unknown }) => {
      for (const m of Array.isArray(messages) ? messages : [messages]) emitted.push({ name: m.name, data: m.data })
    }),
    releaseGroupedEvents: jest.fn(async () => undefined),
    clearGroupedEvents: jest.fn(async () => undefined),
  }
  const container = createMedusaContainer()
  container.register(Modules.EVENT_BUS, asValue(eventBus))
  return { container, emitted }
}

async function run(action: "pause" | "resume" | "cancel") {
  const { container, emitted } = makeContainer()
  const { result } = await manageSubscriptionWorkflow(container).run({
    input: { subscription_id: "sub_1", action },
    throwOnError: true,
  })
  return { result, emitted }
}

describe("shouldEmitSubscriptionCanceled", () => {
  it("is true only for cancel with the flag on (literal \"true\")", () => {
    expect(shouldEmitSubscriptionCanceled({ action: "cancel" })).toBe(false)
    process.env[FLAG] = "1"
    expect(shouldEmitSubscriptionCanceled({ action: "cancel" })).toBe(false)
    process.env[FLAG] = "true"
    expect(shouldEmitSubscriptionCanceled({ action: "cancel" })).toBe(true)
    expect(shouldEmitSubscriptionCanceled({ action: "pause" })).toBe(false)
    expect(shouldEmitSubscriptionCanceled({ action: "resume" })).toBe(false)
  })
})

describe("manageSubscriptionWorkflow publishes subscription.canceled", () => {
  it("on cancel with the flag on, carrying subscription_id", async () => {
    process.env[FLAG] = "true"
    const { result, emitted } = await run("cancel")
    expect(result).toMatchObject({ action: "cancel", success: true })
    expect(SUBSCRIPTION_CANCELED_EVENT).toBe("subscription.canceled")
    expect(emitted).toEqual([{ name: "subscription.canceled", data: { subscription_id: "sub_1" } }])
  })

  it("never with the flag off", async () => {
    const { result, emitted } = await run("cancel")
    expect(result).toMatchObject({ action: "cancel", success: true })
    expect(emitted).toEqual([])
  })

  it("never on pause or resume, even with the flag on", async () => {
    process.env[FLAG] = "true"
    expect((await run("pause")).emitted).toEqual([])
    expect((await run("resume")).emitted).toEqual([])
  })
})
