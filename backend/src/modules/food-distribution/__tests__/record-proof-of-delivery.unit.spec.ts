import { MedusaError } from "@medusajs/framework/utils"
import FoodDistributionService from "../service"
import { deliveryCompletedDescription, proofRequirementLabel } from "../proof-of-delivery"

/**
 * The delivery event `recordProofOfDelivery` saves is served by
 * `GET /store/food-deliveries/:id` to the delivery's producer, courier and
 * recipient. It read "Delivery completed with <TYPE> proof" for every type,
 * so a file the courier chose or a name the courier typed was recorded as
 * proof of the hand-over. Only PIN_CODE needs something the courier does not
 * hold (proof-of-delivery.ts), and only once the PIN has matched: the method
 * runs `proofOfDeliveryError` itself before writing, so no caller (the
 * `/proof` route, the unwired `confirmDeliveryStep`) can have an unchecked
 * PIN saved as "PIN_CODE proof".
 *
 * The real method runs here against a stand-in `this` for the generated CRUD
 * it calls; Postgres sees the saved row in
 * integration-tests/http/store-food-network-write-authz.spec.ts.
 */

// Evidence URLs must name a file in the platform's own storage; configure
// MinIO with a public URL, as production does.
const STORAGE_ENV: Record<string, string> = {
  MINIO_ENDPOINT: "minio",
  MINIO_ACCESS_KEY: "spec-access",
  MINIO_SECRET_KEY: "spec-secret",
  MINIO_BUCKET: "medusa-media",
  MINIO_PUBLIC_URL: "https://media.fbm.test",
}
const savedEnv: Record<string, string | undefined> = {}
beforeAll(() => {
  for (const [key, value] of Object.entries(STORAGE_ENV)) {
    savedEnv[key] = process.env[key]
    process.env[key] = value
  }
})
afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

type Stored = { proof_type: string | null; proof_pin_code: string | null }
type ProofData = { photoUrl?: string; signatureUrl?: string; pinCode?: string; recipientName?: string }

const EVIDENCE: Record<string, ProofData> = {
  PIN_CODE: { pinCode: "4821" },
  PHOTO: { photoUrl: "https://media.fbm.test/medusa-media/p.jpg" },
  SIGNATURE: { signatureUrl: "https://media.fbm.test/medusa-media/s.png" },
  RECIPIENT_CONFIRMATION: { recipientName: "Ada" },
}

function record(proofType: string, proofData: ProofData, stored: Stored) {
  const self = {
    retrieveFoodDelivery: jest.fn(async (id: string) => ({ id, courier_id: "cour_1", ...stored })),
    updateFoodDeliveries: jest.fn(async (data: Record<string, unknown>) => ({ ...data, courier_id: "cour_1" })),
    logDeliveryEvent: jest.fn(async () => ({})),
    updateCouriers: jest.fn(async () => ({})),
  }
  const run = FoodDistributionService.prototype.recordProofOfDelivery.call(
    self as unknown as FoodDistributionService,
    "fd_1",
    proofType,
    proofData
  )
  return { self, run }
}

/** A submission that meets a delivery created to require `proofType`. */
function recordRequired(proofType: string) {
  return record(proofType, EVIDENCE[proofType], {
    proof_type: proofType,
    proof_pin_code: proofType === "PIN_CODE" ? "4821" : null,
  })
}

function savedDescription(self: ReturnType<typeof record>["self"]): string {
  expect(self.logDeliveryEvent).toHaveBeenCalledTimes(1)
  const [deliveryId, event] = self.logDeliveryEvent.mock.calls[0] as unknown as [string, Record<string, unknown>]
  expect(deliveryId).toBe("fd_1")
  expect(event).toEqual(expect.objectContaining({ event_type: "proof_of_delivery", new_status: "DELIVERED" }))
  return String(event.description)
}

async function refusal(run: Promise<unknown>): Promise<MedusaError> {
  const error = await run.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(MedusaError)
  return error as MedusaError
}

function wroteNothing(self: ReturnType<typeof record>["self"]) {
  expect(self.updateFoodDeliveries).not.toHaveBeenCalled()
  expect(self.logDeliveryEvent).not.toHaveBeenCalled()
  expect(self.updateCouriers).not.toHaveBeenCalled()
}

describe("recordProofOfDelivery: the saved delivery event", () => {
  it.each(["PHOTO", "SIGNATURE", "RECIPIENT_CONFIRMATION"])(
    "names %s as courier-attested and never as proof",
    async (type) => {
      const { self, run } = recordRequired(type)
      await run
      const description = savedDescription(self)
      expect(description).toBe(`Delivery completed with ${type} (courier-attested)`)
      expect(description).not.toMatch(/proof/i)
    }
  )

  it("calls a PIN_CODE delivery proof once the PIN matched: the PIN is the recipient's, not the courier's", async () => {
    const { self, run } = recordRequired("PIN_CODE")
    await run
    expect(savedDescription(self)).toBe("Delivery completed with PIN_CODE proof")
  })

  it("still closes the delivery and frees its courier", async () => {
    const { self, run } = recordRequired("PHOTO")
    await run
    expect(self.updateFoodDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fd_1", proof_type: "PHOTO", status: "DELIVERED" })
    )
    expect(self.updateCouriers).toHaveBeenCalledWith({ id: "cour_1", status: "AVAILABLE" })
  })
})

// The method used to save whatever it was given. On a delivery created with
// no requirement, the route's check returned before looking at anything, so
// `{ proof_type: "PIN_CODE" }` with no PIN was saved as "Delivery completed
// with PIN_CODE proof"; `confirmDeliveryStep` passes its input with no check
// at all. The method now refuses, before any write, what the check refuses.
describe("recordProofOfDelivery: writes nothing for a submission the check refuses", () => {
  const noRequirement: Stored = { proof_type: "NONE", proof_pin_code: null }

  it.each([
    ["PIN_CODE with no PIN", "PIN_CODE", {}],
    ["PIN_CODE with a PIN when none is on record", "PIN_CODE", { pinCode: "4821" }],
    ["PHOTO with no photo", "PHOTO", {}],
    ["SIGNATURE with no signature", "SIGNATURE", {}],
    ["RECIPIENT_CONFIRMATION with no name", "RECIPIENT_CONFIRMATION", { recipientName: "  " }],
  ])("on a NONE delivery: %s", async (_label, type, data) => {
    const { self, run } = record(type, data, noRequirement)
    const error = await refusal(run)
    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    wroteNothing(self)
  })

  it("on a PIN_CODE delivery: a wrong PIN, or another type", async () => {
    const required: Stored = { proof_type: "PIN_CODE", proof_pin_code: "4821" }
    for (const [type, data] of [
      ["PIN_CODE", { pinCode: "0000" }],
      ["PHOTO", EVIDENCE.PHOTO],
    ] as const) {
      const { self, run } = record(type, data, required)
      expect((await refusal(run)).type).toBe(MedusaError.Types.INVALID_DATA)
      wroteNothing(self)
    }
  })

  it("accepts a PIN_CODE close on a NONE delivery only against a PIN the producer put on record", async () => {
    const { self, run } = record("PIN_CODE", { pinCode: "4821" }, { proof_type: "NONE", proof_pin_code: "4821" })
    await run
    expect(savedDescription(self)).toBe("Delivery completed with PIN_CODE proof")
  })
})

describe("deliveryCompletedDescription", () => {
  it("is built from proofRequirementLabel, the wording the refusals use", () => {
    for (const type of ["PIN_CODE", "PHOTO", "SIGNATURE", "RECIPIENT_CONFIRMATION"]) {
      expect(deliveryCompletedDescription(type)).toBe(`Delivery completed with ${proofRequirementLabel(type)}`)
    }
  })
})
