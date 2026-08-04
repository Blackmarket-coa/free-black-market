import { describe, expect, it } from "vitest"

import {
  describeCapabilities,
  describeChannelStatus,
  type VendorChannel,
} from "./vendor-channels"

/**
 * A channel that silently stopped syncing is worse than one that was never
 * connected: the vendor believes their stock and orders are flowing when they
 * are not. These cover the states that are easy to render identically and must
 * not be — particularly the Phase 12 pair, where one asks the vendor to act and
 * the other asks them to wait.
 */

const now = new Date("2026-08-04T12:00:00.000Z")

const channel = (overrides: Partial<VendorChannel> = {}): VendorChannel => ({
  id: "faire",
  display_name: "Faire",
  description: "Wholesale marketplace.",
  capabilities: ["push_listing", "pull_orders"],
  available: true,
  credential_hint: "Create an access token.",
  credential_url: "https://faire.test",
  connected: true,
  enabled: true,
  last_synced_at: null,
  orders_synced_through: null,
  last_error: null,
  throttled_until: null,
  needs_reauth: false,
  ...overrides,
})

describe("describeChannelStatus", () => {
  it("reports a healthy connection", () => {
    expect(describeChannelStatus(channel(), now)).toMatchObject({
      label: "Connected",
      tone: "green",
    })
  })

  it("tells a vendor to reconnect when the token is dead", () => {
    // The one state that does not resolve on its own. Rendering it as a
    // generic error would leave a vendor waiting for a sync that will never
    // come.
    const status = describeChannelStatus(
      channel({ needs_reauth: true, last_error: "401 Unauthorized" }),
      now
    )
    expect(status).toMatchObject({ label: "Reconnect needed", tone: "red" })
    expect(status.hint).toMatch(/new one/i)
  })

  it("says to wait when the channel rate-limited us", () => {
    // And does not say "needs attention": there is nothing the vendor can do,
    // and telling them otherwise invites them to re-paste a working token.
    const status = describeChannelStatus(
      channel({
        throttled_until: "2026-08-04T14:00:00.000Z",
        last_error: "The channel rate-limited us. Backing off for 7200s.",
      }),
      now
    )
    expect(status).toMatchObject({ label: "Rate limited", tone: "orange" })
    expect(status.hint).toMatch(/resumes/i)
  })

  it("puts reconnect ahead of a stand-down", () => {
    // Dead credentials also set a long `throttled_until`. Reporting that as
    // "rate limited, resumes in 12 hours" would be true and useless — it will
    // fail again in twelve hours unless somebody acts.
    expect(
      describeChannelStatus(
        channel({
          needs_reauth: true,
          throttled_until: "2026-08-05T00:00:00.000Z",
        }),
        now
      ).label
    ).toBe("Reconnect needed")
  })

  it("stops reporting a stand-down once it has expired", () => {
    // Nothing rewrites the row when a backoff lapses — expiry is a comparison,
    // so a stale timestamp must not pin the panel to "rate limited" forever.
    expect(
      describeChannelStatus(
        channel({ throttled_until: "2026-08-04T11:00:00.000Z" }),
        now
      ).label
    ).toBe("Connected")
  })

  it("still distinguishes paused from errored", () => {
    expect(
      describeChannelStatus(channel({ enabled: false }), now).label
    ).toBe("Paused")
    expect(
      describeChannelStatus(channel({ last_error: "boom" }), now).label
    ).toBe("Needs attention")
  })

  it("does not claim a connection for a channel that is not shipped", () => {
    expect(
      describeChannelStatus(channel({ available: false }), now).label
    ).toBe("Unavailable")
  })
})

describe("describeCapabilities", () => {
  it("describes what a channel will actually do", () => {
    expect(describeCapabilities(["push_listing", "pull_orders"])).toEqual([
      "Lists your products",
      "Imports orders",
    ])
  })

  it("falls back to the raw key rather than dropping an unknown capability", () => {
    // Silently omitting one would understate what a channel does, which is the
    // more dangerous direction: the vendor would not know it was happening.
    expect(
      describeCapabilities(["push_listing", "something_new" as never])
    ).toEqual(["Lists your products", "something_new"])
  })
})
