import FoodDistributionService from "../service"
import { deliveryCompletedDescription, proofRequirementLabel } from "../proof-of-delivery"

/**
 * The delivery event `recordProofOfDelivery` saves is served by
 * `GET /store/food-deliveries/:id` to the delivery's producer, courier and
 * recipient. It read "Delivery completed with <TYPE> proof" for every type,
 * so a file the courier chose or a name the courier typed was recorded as
 * proof of the hand-over. Only PIN_CODE needs something the courier does not
 * hold (proof-of-delivery.ts).
 *
 * The real method runs here against a stand-in `this` for the generated CRUD
 * it calls; Postgres sees the saved row in
 * integration-tests/http/store-food-network-write-authz.spec.ts.
 */
function record(proofType: string) {
  const self = {
    updateFoodDeliveries: jest.fn(async (data: Record<string, unknown>) => ({ ...data, courier_id: "cour_1" })),
    logDeliveryEvent: jest.fn(async () => ({})),
    updateCouriers: jest.fn(async () => ({})),
  }
  const run = FoodDistributionService.prototype.recordProofOfDelivery.call(
    self as unknown as FoodDistributionService,
    "fd_1",
    proofType,
    { photoUrl: "https://media.fbm.test/medusa-media/p.jpg", recipientName: "Ada" }
  )
  return { self, run }
}

function savedDescription(self: ReturnType<typeof record>["self"]): string {
  expect(self.logDeliveryEvent).toHaveBeenCalledTimes(1)
  const [deliveryId, event] = self.logDeliveryEvent.mock.calls[0] as unknown as [string, Record<string, unknown>]
  expect(deliveryId).toBe("fd_1")
  expect(event).toEqual(expect.objectContaining({ event_type: "proof_of_delivery", new_status: "DELIVERED" }))
  return String(event.description)
}

describe("recordProofOfDelivery: the saved delivery event", () => {
  it.each(["PHOTO", "SIGNATURE", "RECIPIENT_CONFIRMATION"])(
    "names %s as courier-attested and never as proof",
    async (type) => {
      const { self, run } = record(type)
      await run
      const description = savedDescription(self)
      expect(description).toBe(`Delivery completed with ${type} (courier-attested)`)
      expect(description).not.toMatch(/proof/i)
    }
  )

  it("calls a PIN_CODE delivery proof: the PIN is the recipient's, not the courier's", async () => {
    const { self, run } = record("PIN_CODE")
    await run
    expect(savedDescription(self)).toBe("Delivery completed with PIN_CODE proof")
  })

  it("still closes the delivery and frees its courier", async () => {
    const { self, run } = record("PHOTO")
    await run
    expect(self.updateFoodDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fd_1", proof_type: "PHOTO", status: "DELIVERED" })
    )
    expect(self.updateCouriers).toHaveBeenCalledWith({ id: "cour_1", status: "AVAILABLE" })
  })
})

describe("deliveryCompletedDescription", () => {
  it("is built from proofRequirementLabel, the wording the refusals use", () => {
    for (const type of ["PIN_CODE", "PHOTO", "SIGNATURE", "RECIPIENT_CONFIRMATION"]) {
      expect(deliveryCompletedDescription(type)).toBe(`Delivery completed with ${proofRequirementLabel(type)}`)
    }
  })
})
