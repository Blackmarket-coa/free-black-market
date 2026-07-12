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
