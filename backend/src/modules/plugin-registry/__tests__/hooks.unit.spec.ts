import {
  PLUGIN_EVENTS,
  buildPluginInstalledPayload,
  buildPluginUninstalledPayload,
  diffExtensions,
  isPluginEvent,
  pluginHookChannelId,
} from "../hooks"

describe("pluginHookChannelId", () => {
  it("namespaces the slug as a synthetic channel id", () => {
    expect(pluginHookChannelId("sales-analytics")).toBe("plugin:sales-analytics")
  })
})

describe("isPluginEvent", () => {
  it("accepts every registry event and rejects everything else", () => {
    for (const event of PLUGIN_EVENTS) {
      expect(isPluginEvent(event)).toBe(true)
    }
    expect(isPluginEvent("order.placed")).toBe(false)
    expect(isPluginEvent("")).toBe(false)
    expect(isPluginEvent(null)).toBe(false)
  })

  it("keeps the contract stable", () => {
    expect(PLUGIN_EVENTS).toEqual([
      "plugin.installed",
      "plugin.uninstalled",
      "plugin.deprecated",
    ])
  })
})

describe("buildPluginInstalledPayload", () => {
  it("includes the seller id for seller installs", () => {
    expect(
      buildPluginInstalledPayload({
        slug: "sales-analytics",
        installer_type: "seller",
        installer_seller_id: "seller_1",
        install_count: 7,
      })
    ).toEqual({
      plugin_slug: "sales-analytics",
      installer_type: "seller",
      installer_seller_id: "seller_1",
      install_count: 7,
    })
  })

  it("NEVER ships an installer id for customer installs (privacy)", () => {
    const payload = buildPluginInstalledPayload({
      slug: "sales-analytics",
      installer_type: "customer",
      // even if a caller mistakenly passes one, it must not leak
      installer_seller_id: "cus_1",
      install_count: 8,
    })
    expect(payload).toEqual({
      plugin_slug: "sales-analytics",
      installer_type: "customer",
      install_count: 8,
    })
    expect("installer_seller_id" in payload).toBe(false)
  })

  it("omits install_count when unknown", () => {
    const payload = buildPluginInstalledPayload({
      slug: "x",
      installer_type: "seller",
      installer_seller_id: "s1",
      install_count: null,
    })
    expect("install_count" in payload).toBe(false)
  })
})

describe("buildPluginUninstalledPayload", () => {
  it("shapes the uninstall payload", () => {
    expect(
      buildPluginUninstalledPayload({ slug: "x", installer_seller_id: "s1" })
    ).toEqual({ plugin_slug: "x", installer_type: "seller", installer_seller_id: "s1" })
  })
})

describe("diffExtensions", () => {
  it("computes installs and uninstalls from the array change", () => {
    expect(diffExtensions(["a", "b"], ["b", "c"])).toEqual({
      installed: ["c"],
      uninstalled: ["a"],
    })
  })

  it("treats null/undefined as empty and collapses duplicates", () => {
    expect(diffExtensions(null, ["a", "a"])).toEqual({ installed: ["a"], uninstalled: [] })
    expect(diffExtensions(["a"], undefined)).toEqual({ installed: [], uninstalled: ["a"] })
  })

  it("is order-insensitive and empty when unchanged", () => {
    expect(diffExtensions(["a", "b"], ["b", "a"])).toEqual({ installed: [], uninstalled: [] })
  })
})

// --- W3 additions: widened uninstall payload + deprecated payload ----------

import {
  buildPluginDeprecatedPayload,
  buildPluginUninstalledPayload as buildUninstalledW3,
} from "../hooks"

describe("buildPluginUninstalledPayload (W3 widening)", () => {
  it("keeps the pre-W3 seller shape by default", () => {
    expect(buildUninstalledW3({ slug: "s", installer_seller_id: "sel_1" })).toEqual({
      plugin_slug: "s",
      installer_type: "seller",
      installer_seller_id: "sel_1",
    })
  })

  it("customer uninstalls carry only the installer type (privacy invariant)", () => {
    expect(buildUninstalledW3({ slug: "s", installer_type: "customer" })).toEqual({
      plugin_slug: "s",
      installer_type: "customer",
    })
    // Even a mistakenly supplied seller id is dropped for customer shape.
    expect(
      buildUninstalledW3({ slug: "s", installer_type: "customer", installer_seller_id: "sel_1" })
    ).toEqual({ plugin_slug: "s", installer_type: "customer" })
  })
})

describe("buildPluginDeprecatedPayload", () => {
  it("carries the slug and an optional reason", () => {
    expect(buildPluginDeprecatedPayload({ slug: "s" })).toEqual({ plugin_slug: "s" })
    expect(buildPluginDeprecatedPayload({ slug: "s", reason: "eol" })).toEqual({
      plugin_slug: "s",
      reason: "eol",
    })
  })
})
