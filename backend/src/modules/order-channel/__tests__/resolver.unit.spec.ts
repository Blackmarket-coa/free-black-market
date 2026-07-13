import {
  isValidChannel,
  resolveOrderChannel,
  summarizeOrdersByChannel,
} from "../resolver"
import { OrderChannel } from "../models/order-channel"

describe("resolveOrderChannel", () => {
  it("honors a valid explicit metadata stamp (case/whitespace tolerant)", () => {
    expect(resolveOrderChannel({ metadata: { order_channel: "pos" } })).toEqual({
      channel: OrderChannel.POS,
      source: "stamp",
    })
    expect(resolveOrderChannel({ metadata: { order_channel: " Pickup " } })).toEqual({
      channel: OrderChannel.PICKUP,
      source: "stamp",
    })
  })

  it("a stamp wins over subscription provenance", () => {
    expect(
      resolveOrderChannel({
        metadata: { order_channel: "vending", subscription_id: "sub_1" },
      })
    ).toEqual({ channel: OrderChannel.VENDING, source: "stamp" })
  })

  it("ignores an invalid stamp and falls through to inference", () => {
    expect(
      resolveOrderChannel({
        metadata: { order_channel: "carrier-pigeon", subscription_id: "sub_1" },
      })
    ).toEqual({ channel: OrderChannel.SUBSCRIPTION, source: "subscription" })
    expect(resolveOrderChannel({ metadata: { order_channel: 42 } })).toEqual({
      channel: OrderChannel.ONLINE,
      source: "default",
    })
  })

  it("infers subscription from subscription_id or renewal flag", () => {
    expect(resolveOrderChannel({ metadata: { subscription_id: "sub_1" } })).toEqual({
      channel: OrderChannel.SUBSCRIPTION,
      source: "subscription",
    })
    expect(resolveOrderChannel({ metadata: { renewal: true } })).toEqual({
      channel: OrderChannel.SUBSCRIPTION,
      source: "subscription",
    })
  })

  it("defaults to online for unstamped orders / missing metadata", () => {
    expect(resolveOrderChannel({ metadata: {} })).toEqual({
      channel: OrderChannel.ONLINE,
      source: "default",
    })
    expect(resolveOrderChannel({ metadata: null })).toEqual({
      channel: OrderChannel.ONLINE,
      source: "default",
    })
  })
})

describe("isValidChannel", () => {
  it("accepts every enum value and rejects everything else", () => {
    for (const value of Object.values(OrderChannel)) {
      expect(isValidChannel(value)).toBe(true)
    }
    expect(isValidChannel("carrier-pigeon")).toBe(false)
    expect(isValidChannel("")).toBe(false)
    expect(isValidChannel(null)).toBe(false)
    expect(isValidChannel(3)).toBe(false)
  })
})

describe("summarizeOrdersByChannel", () => {
  const channels = new Map([
    ["o1", "pos"],
    ["o2", "pos"],
    ["o4", "subscription"],
  ])

  it("groups counts + per-currency totals by channel, defaulting unmapped orders to online", () => {
    const summary = summarizeOrdersByChannel(
      [
        { id: "o1", total: 1000, currency_code: "usd" },
        { id: "o2", total: 500, currency_code: "usd" },
        { id: "o3", total: 250, currency_code: "usd" }, // no row → online
        { id: "o4", total: 2000, currency_code: "eur" },
      ],
      channels
    )

    expect(summary.pos).toEqual({ count: 2, totals: { usd: 1500 } })
    expect(summary.online).toEqual({ count: 1, totals: { usd: 250 } })
    expect(summary.subscription).toEqual({ count: 1, totals: { eur: 2000 } })
  })

  it("keeps currencies separate and tolerates missing totals", () => {
    const summary = summarizeOrdersByChannel(
      [
        { id: "o1", total: 100, currency_code: "usd" },
        { id: "o2", total: 100, currency_code: "eur" },
        { id: "o3", total: null, currency_code: "usd" },
      ],
      new Map([
        ["o1", "pos"],
        ["o2", "pos"],
        ["o3", "pos"],
      ])
    )
    expect(summary.pos).toEqual({ count: 3, totals: { usd: 100, eur: 100 } })
  })

  it("returns an empty summary for no orders", () => {
    expect(summarizeOrdersByChannel([], new Map())).toEqual({})
  })
})
