// The three domain steps are replaced with no-op steps, so the real
// manageSubscriptionWorkflow composition (its `when` branches and the real
// core-flows emitEventStep) runs in-process against a fake event bus.
function mockNoopStep(id: string, output: (input: { subscription_id: string; action?: string }) => unknown) {
  const sdk = require("@medusajs/framework/workflows-sdk")
  return sdk.createStep(id, async (input: { subscription_id: string; action?: string }) => new sdk.StepResponse(output(input)))
}
// The status the stubbed update step reports for a cancel: `canceled` for a
// cancel that ended the subscription, `past_due` for one that started grace.
let mockCancelStatus = "canceled"
const MOCK_STATUS_BY_ACTION: Record<string, string> = { pause: "paused", resume: "active" }
jest.mock("../steps/plan-subscription-cancel", () => ({
  planSubscriptionCancelStep: mockNoopStep("plan-subscription-cancel", () => ({ mode: "legacy" })),
}))
jest.mock("../steps/update-subscription", () => ({
  updateSubscriptionStep: mockNoopStep("update-subscription-step", (i) => ({
    subscription: {
      id: i.subscription_id,
      status: i.action === "cancel" ? mockCancelStatus : MOCK_STATUS_BY_ACTION[i.action ?? ""],
    },
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
 * so manageSubscriptionWorkflow publishes it only on a cancel that ended the
 * subscription AND only while FF_BLACK_MASK_PROVISIONING_V1 is on. A cancel
 * that started grace stays silent here; grace-lifecycle.ts announces it.
 */
const FLAG = PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1

afterEach(() => {
  delete process.env[FLAG]
  mockCancelStatus = "canceled"
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
  const ended = { status: "canceled" }
  it("is true only for cancel with the flag on (literal \"true\")", () => {
    expect(shouldEmitSubscriptionCanceled({ action: "cancel" }, ended)).toBe(false)
    process.env[FLAG] = "1"
    expect(shouldEmitSubscriptionCanceled({ action: "cancel" }, ended)).toBe(false)
    process.env[FLAG] = "true"
    expect(shouldEmitSubscriptionCanceled({ action: "cancel" }, ended)).toBe(true)
    expect(shouldEmitSubscriptionCanceled({ action: "pause" }, ended)).toBe(false)
    expect(shouldEmitSubscriptionCanceled({ action: "resume" }, ended)).toBe(false)
  })

  it("is false for a cancel that did not end the subscription (grace, or no row)", () => {
    process.env[FLAG] = "true"
    expect(shouldEmitSubscriptionCanceled({ action: "cancel" }, { status: "past_due" })).toBe(false)
    expect(shouldEmitSubscriptionCanceled({ action: "cancel" }, undefined)).toBe(false)
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

  it("never on a cancel that started grace, even with the flag on", async () => {
    process.env[FLAG] = "true"
    mockCancelStatus = "past_due"
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
