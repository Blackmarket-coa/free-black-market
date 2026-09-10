import { GET } from "../route"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../../../modules/food-distribution"

/**
 * The courier block on the live-tracking response.
 *
 * `photo_url` read `courier.photo_url`, and `food_courier` has no such
 * column — it has `avatar_url`. So the field was `undefined` on every
 * response since the route shipped and no customer has ever seen a
 * courier's photo. Nothing failed; the key was simply always absent.
 *
 * The response key stays `photo_url`: the value was never populated, so no
 * client can depend on it, and renaming it would be a wire change for no
 * gain.
 */
type TestRes = {
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res: TestRes = {
    body: {},
    status: () => res,
    json: (payload: unknown) => {
      res.body = (payload ?? {}) as Record<string, unknown>
      return res
    },
  }
  return res
}

const makeReq = (courier: Record<string, unknown> | null) => ({
  params: { id: "del_1" },
  scope: {
    resolve: (key: string) => {
      if (key === FOOD_DISTRIBUTION_MODULE) {
        return {
          retrieveFoodDelivery: jest.fn(async () => ({
            id: "del_1",
            status: "EN_ROUTE_DELIVERY",
            courier_id: courier ? "cour_1" : null,
          })),
          retrieveCourier: jest.fn(async () => courier),
        }
      }
      throw new Error(`unresolvable: ${String(key)}`)
    },
  },
})

describe("GET /store/food-deliveries/:id/track — courier block", () => {
  it("serves the avatar, which is the column that exists", async () => {
    const res = createRes()
    await GET(
      makeReq({
        first_name: "Ada",
        display_name: "Ada O.",
        vehicle_type: "EBIKE",
        avatar_url: "https://example.com/ada.jpg",
      }) as never,
      res as never
    )

    expect(res.body.courier).toEqual({
      name: "Ada O.",
      vehicle_type: "EBIKE",
      photo_url: "https://example.com/ada.jpg",
    })
  })

  it("falls back to the first name when display_name is unset", async () => {
    const res = createRes()
    await GET(
      makeReq({ first_name: "Ada", display_name: null, vehicle_type: "BIKE" }) as never,
      res as never
    )

    expect((res.body.courier as Record<string, unknown>).name).toBe("Ada")
  })

  it("sends null rather than undefined for a courier with no avatar", async () => {
    const res = createRes()
    await GET(makeReq({ first_name: "Ada", vehicle_type: "BIKE" }) as never, res as never)

    expect((res.body.courier as Record<string, unknown>).photo_url).toBeNull()
  })

  it("still reports no courier when none is assigned", async () => {
    const res = createRes()
    await GET(makeReq(null) as never, res as never)

    expect(res.body.courier).toBeNull()
  })

  it("publishes nothing else about the courier", async () => {
    // The "public only" intent the original comment stated.
    const res = createRes()
    await GET(
      makeReq({
        first_name: "Ada",
        last_name: "Okonkwo",
        email: "ada@example.com",
        phone: "+15551234567",
        vehicle_type: "EBIKE",
        avatar_url: "https://example.com/ada.jpg",
      }) as never,
      res as never
    )

    expect(Object.keys(res.body.courier as object).sort()).toEqual([
      "name",
      "photo_url",
      "vehicle_type",
    ])
  })
})
