import type { ToolSchema } from "./supervisor-agent.entrypoint";

/**
 * Vendor-safe tool registry exposed to Hermes for onboarding and product draft flows.
 *
 * Keep this list intentionally minimal and schema-constrained.
 */
export const VENDOR_SAFE_TOOL_SCHEMAS: readonly ToolSchema[] = [
  {
    action: "create_vendor",
    required: ["business_name", "contact_email", "country_code"],
    properties: {
      business_name: "string",
      contact_email: "string",
      country_code: "string",
      tax_id: "string",
      phone: "string",
      onboarding_notes: "string",
    },
    additionalProperties: false,
  },
  {
    action: "create_product",
    required: ["title", "description", "price", "currency_code"],
    properties: {
      title: "string",
      description: "string",
      price: "number",
      currency_code: "string",
      category: "string",
      inventory_quantity: "number",
      sku: "string",
    },
    additionalProperties: false,
  },
  {
    action: "delete_product",
    required: ["product_id"],
    properties: {
      product_id: "string",
      reason: "string",
    },
    additionalProperties: false,
    destructive: true,
  },
];
