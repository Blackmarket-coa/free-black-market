jest.mock("../../../lib/blackout-spatial", () => ({
  ...jest.requireActual("../../../lib/blackout-spatial"),
  geocodePostalCode: jest.fn(async () => null),
}))

import { geocodePostalCode } from "../../../lib/blackout-spatial"
import {
  buildDeliveryOptionSelectedPayload,
  normalizeOrigin,
  pickCoalitionRefs,
  resolveBlackstarCoalitionRefs,
  resolveBlackstarOrigin,
} from "../../../lib/blackstar-delivery-payload"
import emitBlackstarDeliveryOptionSelected, {
  config as subscriberConfig,
} from "../../../subscribers/emit-blackstar-delivery-option-selected"
import BlackstarFulfillmentProviderService from "../service"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../../blackstar-fulfillment"
import { ORDER_CYCLE_MODULE } from "../../order-cycle"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../marketplace-webhooks"
import MarketplaceWebhooksService from "../../marketplace-webhooks/service"

const geocode = geocodePostalCode as jest.MockedFunction<typeof geocodePostalCode>

/**
 * The fields Blackstar's receiver reads off `delivery.option.selected`
 * (Blackstar `api/app/Services/FreeBlackMarket/InboundEventProcessor.php`,
 * `applyEvent`), with the types its columns hold:
 *   origin_latitude / origin_longitude — decimal(10,7)  → JSON numbers
 *   coalition_ref / drive_ref           — string(255)    → JSON strings
 * Each is optional there (`$payload[...] ?? null`), so FBM omits the key
 * rather than sending null or a guess.
 */
const OPTIONAL_CONTRACT_FIELDS = [
  "origin_latitude",
  "origin_longitude",
  "coalition_ref",
  "drive_ref",
] as const

const BASE_PAYLOAD = {
  delivery_option: "federated_delivery_network",
  source_order_ref: "order_1",
  claim_policy: "first_claim",
  job_type: "delivery",
  fulfillment_node_id: null,
  pickup_point_id: null,
  vending_machine_id: null,
}

function containerOf(registry: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (!(key in registry)) throw new Error(`Could not resolve '${key}'.`)
      return registry[key]
    },
  } as any
}

function stockLocationQuery(address: Record<string, unknown> | null) {
  return {
    graph: jest.fn(async ({ entity }: { entity: string }) => {
      if (entity === "stock_location") {
        return { data: [{ id: "sloc_1", address }] }
      }
      return { data: [] }
    }),
  }
}

function orderCycleService(
  sales: { order_cycle_id: string }[],
  cycles: Record<string, unknown>[]
) {
  return {
    listOrderCycleSales: jest.fn(async () => sales),
    listOrderCycles: jest.fn(async (f: { id: string[] }) =>
      cycles.filter((c) => f.id.includes(c.id as string))
    ),
  }
}

beforeEach(() => {
  geocode.mockReset()
  geocode.mockResolvedValue(null)
})

describe("buildDeliveryOptionSelectedPayload", () => {
  it("sends only the listing basics when nothing optional is known", () => {
    const payload = buildDeliveryOptionSelectedPayload({ orderId: "order_1" })

    expect(payload).toEqual(BASE_PAYLOAD)
    for (const field of OPTIONAL_CONTRACT_FIELDS) {
      expect(payload).not.toHaveProperty(field)
    }
  })

  it("adds origin coordinates and coalition refs under Blackstar's names and types", () => {
    const payload = buildDeliveryOptionSelectedPayload({
      orderId: "order_1",
      fulfillmentNodeId: "node_1",
      origin: { latitude: 37.8, longitude: -122.4 },
      coalition: { coalition_ref: "coa_westside", drive_ref: "camp_1" },
    })

    expect(payload).toEqual({
      ...BASE_PAYLOAD,
      fulfillment_node_id: "node_1",
      origin_latitude: 37.8,
      origin_longitude: -122.4,
      coalition_ref: "coa_westside",
      drive_ref: "camp_1",
    })
    expect(typeof payload.origin_latitude).toBe("number")
    expect(typeof payload.origin_longitude).toBe("number")
    expect(typeof payload.coalition_ref).toBe("string")
    expect(typeof payload.drive_ref).toBe("string")
    // Survives the JSON envelope as numbers, not strings.
    expect(JSON.parse(JSON.stringify(payload)).origin_latitude).toBe(37.8)
  })

  it("never sends one coordinate without the other, or an impossible one", () => {
    for (const origin of [
      { latitude: Number.NaN, longitude: -122.4 },
      { latitude: 37.8, longitude: Number.POSITIVE_INFINITY },
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: -181 },
      { latitude: "37.8" as unknown as number, longitude: -122.4 },
    ]) {
      const payload = buildDeliveryOptionSelectedPayload({ orderId: "order_1", origin })
      expect(payload).not.toHaveProperty("origin_latitude")
      expect(payload).not.toHaveProperty("origin_longitude")
    }
  })

  it("rounds coordinates to the decimal(10,7) column", () => {
    expect(normalizeOrigin(37.774929123456, -122.419415987654)).toEqual({
      latitude: 37.7749291,
      longitude: -122.419416,
    })
  })

  it("omits drive_ref without a coalition_ref, and refs the columns cannot hold", () => {
    expect(
      buildDeliveryOptionSelectedPayload({
        orderId: "order_1",
        coalition: { coalition_ref: "", drive_ref: "camp_1" },
      })
    ).toEqual(BASE_PAYLOAD)

    expect(
      buildDeliveryOptionSelectedPayload({
        orderId: "order_1",
        coalition: { coalition_ref: "c".repeat(256), drive_ref: "camp_1" },
      })
    ).toEqual(BASE_PAYLOAD)

    const noDrive = buildDeliveryOptionSelectedPayload({
      orderId: "order_1",
      coalition: { coalition_ref: "coa_westside" },
    })
    expect(noDrive.coalition_ref).toBe("coa_westside")
    expect(noDrive).not.toHaveProperty("drive_ref")
  })
})

describe("pickCoalitionRefs", () => {
  const westside = { blackout_coalition_id: "coa_westside", blackout_campaign_id: "camp_1" }

  it("names the coalition and drive when every cycle agrees", () => {
    expect(pickCoalitionRefs([westside])).toEqual({
      coalition_ref: "coa_westside",
      drive_ref: "camp_1",
    })
    expect(pickCoalitionRefs([westside, { ...westside }])).toEqual({
      coalition_ref: "coa_westside",
      drive_ref: "camp_1",
    })
  })

  it("omits everything for an ordinary cycle, a mixed order, or two coalitions", () => {
    expect(pickCoalitionRefs([])).toBeNull()
    expect(
      pickCoalitionRefs([{ blackout_coalition_id: null, blackout_campaign_id: null }])
    ).toBeNull()
    expect(
      pickCoalitionRefs([westside, { blackout_coalition_id: null, blackout_campaign_id: null }])
    ).toBeNull()
    expect(
      pickCoalitionRefs([
        westside,
        { blackout_coalition_id: "coa_eastside", blackout_campaign_id: "camp_1" },
      ])
    ).toBeNull()
  })

  it("keeps the coalition but drops the drive when campaigns disagree or are missing", () => {
    expect(
      pickCoalitionRefs([
        westside,
        { blackout_coalition_id: "coa_westside", blackout_campaign_id: "camp_2" },
      ])
    ).toEqual({ coalition_ref: "coa_westside" })
    expect(
      pickCoalitionRefs([{ blackout_coalition_id: "coa_westside", blackout_campaign_id: null }])
    ).toEqual({ coalition_ref: "coa_westside" })
  })
})

describe("resolveBlackstarOrigin", () => {
  it("geocodes a US stock location's ZIP through the ZIP3 table when Blackout's geocoder is off", async () => {
    const query = stockLocationQuery({ postal_code: "94110", country_code: "us" })
    const origin = await resolveBlackstarOrigin(containerOf({ query }), "sloc_1")

    expect(origin).toEqual({ latitude: 37.8, longitude: -122.4 })
    expect(geocode).toHaveBeenCalledWith("94110")
    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "stock_location", filters: { id: "sloc_1" } })
    )
  })

  it("prefers Blackout's geocoder when it answers, and accepts ZIP+4", async () => {
    geocode.mockResolvedValue({
      latitude: 37.7485,
      longitude: -122.4184,
      label: "94110",
      approximate: true,
    })
    const query = stockLocationQuery({ postal_code: "94110-1234", country_code: "US" })

    await expect(resolveBlackstarOrigin(containerOf({ query }), "sloc_1")).resolves.toEqual({
      latitude: 37.7485,
      longitude: -122.4184,
    })
    expect(geocode).toHaveBeenCalledWith("94110")
  })

  it("sends no origin for a non-US, postcode-less or malformed address", async () => {
    for (const address of [
      { postal_code: "10115", country_code: "de" },
      { postal_code: "94110", country_code: null },
      { postal_code: null, country_code: "us" },
      { postal_code: "9411", country_code: "us" },
      { postal_code: "M5V 2T6", country_code: "us" },
      null,
    ]) {
      const query = stockLocationQuery(address)
      await expect(resolveBlackstarOrigin(containerOf({ query }), "sloc_1")).resolves.toBeNull()
    }
    // A bare German postcode would otherwise read as New York's 101xx.
    expect(geocode).not.toHaveBeenCalled()
  })

  it("sends no origin for a US ZIP neither lookup knows", async () => {
    const query = stockLocationQuery({ postal_code: "00000", country_code: "us" })
    await expect(resolveBlackstarOrigin(containerOf({ query }), "sloc_1")).resolves.toBeNull()
  })

  it("sends the ZIP3 centroid, never the foreign point, when Blackout's geocoder answers with another country's postcode", async () => {
    // What a Nominatim with no country bias ranks first for these bare ZIPs.
    for (const [zip, foreign, zip3] of [
      ["94110", [48.6184713, 13.7669189], { latitude: 37.8, longitude: -122.4 }], // Wegscheid, Bavaria
      ["10115", [45.806, 15.967], { latitude: 40.8, longitude: -73.9 }], // Zagreb
    ] as const) {
      geocode.mockResolvedValueOnce({
        latitude: foreign[0],
        longitude: foreign[1],
        label: "elsewhere",
        approximate: true,
      })
      const query = stockLocationQuery({ postal_code: zip, country_code: "us" })
      const origin = await resolveBlackstarOrigin(containerOf({ query }), "sloc_1")

      expect(origin).toEqual(zip3)
      expect(origin).not.toEqual({ latitude: foreign[0], longitude: foreign[1] })
      expect(geocode).toHaveBeenLastCalledWith(zip)
    }
  })

  it("sends the ZIP3 centroid when Blackout's answer is in the US but far outside the ZIP's area", async () => {
    // Los Angeles for a San Francisco ZIP: ~350 mi from the 941 centroid.
    geocode.mockResolvedValue({
      latitude: 34.0522,
      longitude: -118.2437,
      label: "Los Angeles",
      approximate: true,
    })
    const query = stockLocationQuery({ postal_code: "94110", country_code: "us" })
    await expect(resolveBlackstarOrigin(containerOf({ query }), "sloc_1")).resolves.toEqual({
      latitude: 37.8,
      longitude: -122.4,
    })
  })

  it("sends no origin for a US ZIP the ZIP3 table lacks, whatever Blackout would answer", async () => {
    // 886 is not an assigned ZIP3 prefix, so nothing can vouch for a remote
    // answer; a same-digits Mexican postcode would sit inside any crude US
    // bounding box.
    geocode.mockResolvedValue({
      latitude: 26.0922,
      longitude: -98.2778,
      label: "elsewhere",
      approximate: true,
    })
    const query = stockLocationQuery({ postal_code: "88601", country_code: "us" })
    await expect(resolveBlackstarOrigin(containerOf({ query }), "sloc_1")).resolves.toBeNull()
    expect(geocode).not.toHaveBeenCalled()
  })

  it("is fail-soft: no location id or a failing lookup means no origin", async () => {
    const query = { graph: jest.fn(async () => { throw new Error("db down") }) }
    await expect(resolveBlackstarOrigin(containerOf({ query }), null)).resolves.toBeNull()
    expect(query.graph).not.toHaveBeenCalled()
    await expect(resolveBlackstarOrigin(containerOf({ query }), "sloc_1")).resolves.toBeNull()
  })
})

describe("resolveBlackstarCoalitionRefs", () => {
  it("reads the coalition window from the order's recorded cycle sales", async () => {
    const svc = orderCycleService(
      [{ order_cycle_id: "oc_1" }, { order_cycle_id: "oc_1" }],
      [{ id: "oc_1", blackout_coalition_id: "coa_westside", blackout_campaign_id: "camp_1" }]
    )
    await expect(
      resolveBlackstarCoalitionRefs(containerOf({ [ORDER_CYCLE_MODULE]: svc }), "order_1")
    ).resolves.toEqual({ coalition_ref: "coa_westside", drive_ref: "camp_1" })
    expect(svc.listOrderCycleSales).toHaveBeenCalledWith({
      source: "medusa_order",
      source_id: "order_1",
    })
    expect(svc.listOrderCycles).toHaveBeenCalledWith({ id: ["oc_1"] })
  })

  it("omits the refs for an order with no cycle sales", async () => {
    const svc = orderCycleService([], [])
    await expect(
      resolveBlackstarCoalitionRefs(containerOf({ [ORDER_CYCLE_MODULE]: svc }), "order_1")
    ).resolves.toBeNull()
    expect(svc.listOrderCycles).not.toHaveBeenCalled()
  })

  it("omits the refs when a sale's cycle no longer resolves, or the lookup fails", async () => {
    const svc = orderCycleService(
      [{ order_cycle_id: "oc_1" }, { order_cycle_id: "oc_gone" }],
      [{ id: "oc_1", blackout_coalition_id: "coa_westside", blackout_campaign_id: "camp_1" }]
    )
    await expect(
      resolveBlackstarCoalitionRefs(containerOf({ [ORDER_CYCLE_MODULE]: svc }), "order_1")
    ).resolves.toBeNull()

    await expect(resolveBlackstarCoalitionRefs(containerOf({}), "order_1")).resolves.toBeNull()
  })
})

describe("emit-blackstar-delivery-option-selected subscriber", () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    process.env.BLACKSTAR_WEBHOOK_SECRET = "blackstar_bridge_test_secret_0123"
    process.env.BLACKSTAR_API_BASE = "https://blackstar.example"
  })
  afterEach(() => {
    process.env = { ...origEnv }
  })

  function harness(opts: {
    providerId?: string
    shippingData?: Record<string, unknown>
    address?: Record<string, unknown> | null
    sales?: { order_cycle_id: string }[]
    cycles?: Record<string, unknown>[]
    existingShipment?: boolean
  }) {
    const query = {
      graph: jest.fn(async ({ entity }: { entity: string }) => {
        if (entity === "fulfillment") {
          return {
            data: [
              {
                id: "ful_1",
                provider_id: opts.providerId ?? "blackstar_blackstar",
                location_id: "sloc_1",
                data: opts.shippingData ?? {},
              },
            ],
          }
        }
        if (entity === "stock_location") {
          return { data: [{ id: "sloc_1", address: opts.address ?? null }] }
        }
        return { data: [] }
      }),
    }

    const shipments = {
      listBlackstarShipments: jest.fn(async () =>
        opts.existingShipment ? [{ id: "bsh_1", external_status: "claimed" }] : []
      ),
      recordOrUpdateShipment: jest.fn(async (input: any) => ({ id: "bsh_1", ...input })),
    }

    // The real webhooks service, CRUD patched in memory, so the payload is
    // checked where it actually lands: nested under the envelope's `payload`.
    const deliveries: any[] = []
    const webhooks = Object.create(
      MarketplaceWebhooksService.prototype
    ) as MarketplaceWebhooksService
    ;(webhooks as any).listWebhookDeliveries = async (f: Record<string, any> = {}) =>
      deliveries.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v))
    ;(webhooks as any).createWebhookDeliveries = async (input: any) => {
      const row = { id: `whd_${deliveries.length + 1}`, ...input }
      deliveries.push(row)
      return row
    }

    const container = containerOf({
      query,
      [BLACKSTAR_FULFILLMENT_MODULE]: shipments,
      [ORDER_CYCLE_MODULE]: orderCycleService(opts.sales ?? [], opts.cycles ?? []),
      [MARKETPLACE_WEBHOOKS_MODULE]: webhooks,
    })

    const run = (data: Record<string, unknown> = { order_id: "order_1", fulfillment_id: "ful_1" }) =>
      emitBlackstarDeliveryOptionSelected({
        event: { name: "order.fulfillment_created", data },
        container,
      } as any)

    return { run, query, shipments, deliveries }
  }

  it("listens for the fulfillment-created moment", () => {
    expect(subscriberConfig.event).toBe("order.fulfillment_created")
  })

  it("records the shipment and emits origin + coalition refs for a coalition drive", async () => {
    const h = harness({
      shippingData: { fulfillment_node_id: "node_1", metadata: { note: "x" } },
      address: { postal_code: "94110", country_code: "us" },
      sales: [{ order_cycle_id: "oc_1" }],
      cycles: [{ id: "oc_1", blackout_coalition_id: "coa_westside", blackout_campaign_id: "camp_1" }],
    })
    await h.run()

    expect(h.shipments.recordOrUpdateShipment).toHaveBeenCalledWith({
      order_id: "order_1",
      fulfillment_id: "ful_1",
      fulfillment_node_id: "node_1",
      pickup_point_id: null,
      vending_machine_id: null,
      external_status: "pending",
      metadata: { note: "x" },
    })

    expect(h.deliveries).toHaveLength(1)
    const envelope = h.deliveries[0].payload
    expect(envelope.event_id).toBe("blackstar:delivery.option.selected:order_1:ful_1")
    expect(envelope.event_type).toBe("delivery.option.selected")
    expect(envelope.correlation_id).toBe("order_1")
    expect(envelope.payload).toEqual({
      ...BASE_PAYLOAD,
      fulfillment_node_id: "node_1",
      origin_latitude: 37.8,
      origin_longitude: -122.4,
      coalition_ref: "coa_westside",
      drive_ref: "camp_1",
    })
  })

  it("puts the ZIP3 origin on the wire, not the foreign point Blackout's geocoder answered", async () => {
    geocode.mockResolvedValue({
      latitude: 48.6184713,
      longitude: 13.7669189,
      label: "Wegscheid",
      approximate: true,
    })
    const h = harness({ address: { postal_code: "94110", country_code: "us" } })
    await h.run()

    expect(h.deliveries).toHaveLength(1)
    const payload = h.deliveries[0].payload.payload
    expect(payload).toEqual({
      ...BASE_PAYLOAD,
      origin_latitude: 37.8,
      origin_longitude: -122.4,
    })
    expect(payload.origin_latitude).not.toBe(48.6184713)
    expect(payload.origin_longitude).not.toBe(13.7669189)
  })

  it("omits every optional field for an ordinary order from a location with no ZIP", async () => {
    const h = harness({ address: { postal_code: null, country_code: "us" } })
    await h.run()

    expect(h.deliveries).toHaveLength(1)
    const payload = h.deliveries[0].payload.payload
    expect(payload).toEqual(BASE_PAYLOAD)
    for (const field of OPTIONAL_CONTRACT_FIELDS) {
      expect(payload).not.toHaveProperty(field)
    }
  })

  it("does nothing for a fulfillment on another provider", async () => {
    const h = harness({ providerId: "manual_manual" })
    await h.run()

    expect(h.shipments.recordOrUpdateShipment).not.toHaveBeenCalled()
    expect(h.deliveries).toHaveLength(0)
  })

  it("does not rewind an existing shipment row on redelivery, and re-emits idempotently", async () => {
    const h = harness({ existingShipment: true })
    await h.run()
    await h.run()

    expect(h.shipments.recordOrUpdateShipment).not.toHaveBeenCalled()
    expect(h.deliveries).toHaveLength(1)
  })

  it("ignores an event without an order and fulfillment id", async () => {
    const h = harness({})
    await h.run({ order_id: "order_1" })
    await h.run({ fulfillment_id: "ful_1" })

    expect(h.query.graph).not.toHaveBeenCalled()
    expect(h.deliveries).toHaveLength(0)
  })
})

describe("BlackstarFulfillmentProviderService.createFulfillment", () => {
  it("hands the shipping data back without touching its container", async () => {
    // What Medusa passes a provider: the fulfillment module's cradle, where
    // any FBM key (and `resolve` itself) throws on access.
    const cradle = new Proxy(
      {},
      {
        get: (_t, key) => {
          throw new Error(`Could not resolve '${String(key)}'.`)
        },
      }
    )
    const provider = new BlackstarFulfillmentProviderService(cradle)
    const data = { fulfillment_node_id: "node_1" }

    await expect(
      provider.createFulfillment(data, [], { id: "order_1" } as any, { id: "ful_1" } as any)
    ).resolves.toEqual({ data, labels: [] })
  })
})
