import { readFileSync } from "fs"
import { join } from "path"
import {
  CHANNEL_CATALOG,
  CHANNEL_IDS,
  PILOT_CHANNEL,
  getChannelDefinition,
  isChannelId,
} from "../catalog"
import { getChannelAdapter, registeredChannelIds } from "../adapters"
import { CHANNEL_CAPABILITIES, ChannelApiError } from "../types"

describe("the channel catalogue", () => {
  it("ships an adapter for every catalogued channel", () => {
    // A catalogue entry with no adapter shows a vendor a connect button that
    // cannot work.
    for (const definition of CHANNEL_CATALOG) {
      expect(getChannelAdapter(definition.id)).not.toBeNull()
    }
    expect(CHANNEL_CATALOG.length).toBeGreaterThan(0)
  })

  it("declares exactly the capabilities its adapter implements", () => {
    // The load-bearing drift test. The catalogue is what the UI advertises;
    // the adapter is what runs. A capability in one and not the other is
    // either a promise we cannot keep or a feature nobody can reach.
    for (const definition of CHANNEL_CATALOG) {
      const adapter = getChannelAdapter(definition.id)
      expect([...(adapter?.capabilities ?? [])].sort()).toEqual(
        [...definition.capabilities].sort()
      )
    }
  })

  it("only declares capabilities whose method actually exists", () => {
    // Stronger than the drift test: a declared capability with no method is a
    // runtime crash the moment someone uses it.
    const methodFor = {
      push_listing: "pushListing",
      push_inventory: "pushInventory",
      pull_orders: "pullOrders",
      push_fulfillment: "pushFulfillment",
    } as const

    for (const id of registeredChannelIds()) {
      const adapter = getChannelAdapter(id)!
      for (const capability of CHANNEL_CAPABILITIES) {
        const implemented =
          typeof (adapter as unknown as Record<string, unknown>)[
            methodFor[capability]
          ] === "function"
        expect(adapter.supports(capability)).toBe(implemented)
      }
    }
  })

  it("keeps ids, lookup and the guard in agreement", () => {
    for (const id of CHANNEL_IDS) {
      expect(isChannelId(id)).toBe(true)
      expect(getChannelDefinition(id)?.id).toBe(id)
    }
    expect(isChannelId("shopify")).toBe(false)
    expect(getChannelDefinition("shopify")).toBeNull()
    expect(isChannelId(null)).toBe(false)
  })

  it("returns null for an unknown adapter rather than throwing", () => {
    // A stored connection naming a channel this build no longer ships is a
    // real state after a rollback; it must read as "unavailable", not 500 the
    // vendor's channel list.
    expect(getChannelAdapter("shopify")).toBeNull()
  })

  it("gives every channel a way for a vendor to get credentials", () => {
    for (const definition of CHANNEL_CATALOG) {
      expect(definition.credential_hint.length).toBeGreaterThan(0)
      expect(definition.credential_url).toMatch(/^https:\/\//)
      expect(definition.api_base_url).toMatch(/^https:\/\//)
    }
  })

  it("names a pilot that is in the catalogue", () => {
    expect(isChannelId(PILOT_CHANNEL)).toBe(true)
  })
})

describe("the channel route is gated as a paid capability", () => {
  // The roadmap requires connecting an outbound channel to be itself tiered
  // and billable. Read from the real file so it cannot drift.
  const middlewares = readFileSync(
    join(__dirname, "..", "..", "..", "api", "middlewares.ts"),
    "utf8"
  )

  it("gates /vendor/channels on the channel-sync plan key", () => {
    const block = middlewares
      .split(/\n\s*\{\s*\n/)
      .find((b) => b.includes('matcher: "/vendor/channels'))

    expect(block).toBeDefined()
    expect(block).toContain('requirePlanFeature("vendor.channel_sync")')
  })

  it("puts the platform kill switch before the paywall", () => {
    // Otherwise a deployment with channel sync switched off would still offer
    // to sell it.
    const block = middlewares
      .split(/\n\s*\{\s*\n/)
      .find((b) => b.includes('matcher: "/vendor/channels'))!

    expect(block.indexOf("requireFeatureFlagMiddleware(")).toBeLessThan(
      block.indexOf("requirePlanFeature(")
    )
  })
})

describe("ChannelApiError", () => {
  it("marks transport, rate-limit and channel faults retryable", () => {
    // These will plausibly succeed on a second attempt.
    for (const status of [0, 429, 500, 502, 503]) {
      expect(new ChannelApiError("x", status, "faire").retryable).toBe(true)
    }
  })

  it("marks a rejection non-retryable", () => {
    // A 422 on a malformed listing fails identically forever; retrying it
    // burns the job queue and delays everything behind it.
    for (const status of [400, 401, 403, 404, 422]) {
      expect(new ChannelApiError("x", status, "faire").retryable).toBe(false)
    }
  })

  it("carries the channel and a bounded body for diagnosis", () => {
    const err = new ChannelApiError("nope", 422, "faire", "detail")
    expect(err.channelId).toBe("faire")
    expect(err.body).toBe("detail")
    expect(err.name).toBe("ChannelApiError")
  })
})
