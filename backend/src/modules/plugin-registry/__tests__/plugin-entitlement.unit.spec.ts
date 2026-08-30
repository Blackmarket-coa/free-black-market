import {
  buildPluginGrantInput,
  pluginFeatureKey,
} from "../entitlement"
import {
  EntitlementKind,
  EntitlementSource,
} from "../../entitlement/models/entitlement"

describe("pluginFeatureKey", () => {
  it("namespaces the slug under plugin:", () => {
    expect(pluginFeatureKey("analytics-pro")).toBe("plugin:analytics-pro")
  })
})

describe("buildPluginGrantInput", () => {
  it("builds a manual plugin-kind grant scoped to the customer", () => {
    const input = buildPluginGrantInput({ slug: "analytics-pro", customerId: "cus_1" })
    expect(input).toEqual({
      customer_id: "cus_1",
      feature_key: "plugin:analytics-pro",
      kind: EntitlementKind.PLUGIN,
      source: EntitlementSource.MANUAL,
      metadata: { plugin_slug: "analytics-pro" },
    })
  })
})

// --- W3 addition: seller-scoped grant builder ------------------------------

import { buildSellerPluginGrantInput } from "../entitlement"

describe("buildSellerPluginGrantInput", () => {
  it("keys the grant by seller_id with the same plugin:<slug> convention", () => {
    const input = buildSellerPluginGrantInput({ slug: "sales-analytics", sellerId: "sel_1" })
    expect(input).toMatchObject({
      seller_id: "sel_1",
      feature_key: "plugin:sales-analytics",
      metadata: { plugin_slug: "sales-analytics" },
    })
    expect(input).not.toHaveProperty("customer_id")
  })
})
