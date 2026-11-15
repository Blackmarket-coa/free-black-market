import { render } from "@react-email/components"
import type { ReactElement } from "react"
import { EMAIL_TEMPLATE_RENDERERS } from "../emails/registry"
import { EMAIL_TEMPLATE_NAMES, type EmailTemplateName } from "../templates"
import { orderSummaryLines } from "../order-summary"

/**
 * The real templates, rendered. Every other email spec replaces the `.tsx`
 * files with markers (they test which template a provider picks, not what it
 * draws), so before this a render-time throw — an Intl RangeError on a bad
 * currency code, a prop the template reads that the caller never sends —
 * would have shown up only as a failed send in production.
 *
 * Each template gets props shaped like its caller's `data`, and must render
 * to HTML that contains what the reader needs. No transport is involved.
 */

const html = (name: EmailTemplateName, props: unknown) =>
  render(EMAIL_TEMPLATE_RENDERERS[name](props) as ReactElement)
const text = (name: EmailTemplateName, props: unknown) =>
  render(EMAIL_TEMPLATE_RENDERERS[name](props) as ReactElement, { plainText: true })

/** The taxed, discounted order from the integration spec, as the subscriber sends it. */
const taxedOrder = {
  order: {
    id: "order_01TEST",
    display_id: 1042,
    currency_code: "usd",
    total: 25.3,
    item_subtotal: 20,
    discount_subtotal: 5,
    tax_total: 2.3,
    credit_line_total: 0,
    items: [
      {
        id: "ordli_1",
        thumbnail: "https://img.example.com/honey.png",
        product_title: "Raw Wildflower Honey",
        variant_title: "16 oz",
        quantity: 2,
        subtotal: 20,
      },
    ],
    shipping_methods: [{ id: "ordsm_1", name: "Standard Shipping", subtotal: 8 }],
    customer: { first_name: "Jordan" },
    shipping_address: { first_name: "Jordan" },
  },
}

/** What each caller in src/ puts in `data` (see email-template-coverage.unit.spec.ts for the callers). */
const CALLER_PROPS: Record<EmailTemplateName, { props: unknown; expect: string[] }> = {
  "order-placed": { props: taxedOrder, expect: ["Thank you for your order, Jordan", "Raw Wildflower Honey", "$25.30"] },
  "user-invited": { props: { invite_url: "https://admin.example.com/invite?token=t" }, expect: ["https://admin.example.com/invite?token=t"] },
  "password-reset": { props: { reset_url: "https://shop.example.com/reset?token=t", email: "a@example.com" }, expect: ["https://shop.example.com/reset?token=t"] },
  "vendor-accepted": { props: { seller_name: "Maple Grove Farms", member_name: "Avery", vendor_panel_url: "https://vendor.example.com" }, expect: ["Maple Grove Farms"] },
  "customer-accepted": { props: { customer_name: "Sam", storefront_url: "https://shop.example.com" }, expect: ["Sam"] },
  "booking-confirmation": { props: { customer_name: "Jordan", vendor_name: "Maple Grove Studio", starts_at: "2026-07-01T15:00:00.000Z" }, expect: ["Maple Grove Studio"] },
  "review-request": { props: { customer_name: "Jordan", vendor_name: "Maple Grove Farms", product_title: "Honey", review_url: "https://shop.example.com/review?token=t" }, expect: ["https://shop.example.com/review?token=t"] },
  "embed-chat-message": { props: { vendor_name: "Maple Grove Studio", customer_email: "shopper@example.com", message: "Do you ship to Canada?" }, expect: ["Do you ship to Canada?", "shopper@example.com"] },
  "seller-email-verification": { props: { seller_name: "Maple Grove Farms", verify_url: "https://vendor.example.com/verify?token=t", expires_in_hours: 24 }, expect: ["https://vendor.example.com/verify?token=t"] },
  "digital-order-template": { props: { products: [{ name: "Seed Saving Guide", medias: ["https://files.example.com/guide.pdf"] }] }, expect: ["Seed Saving Guide", "https://files.example.com/guide.pdf"] },
  "seller-invitation": { props: { registration_url: "https://vendor.example.com/vendor/register", email: "grower@example.com" }, expect: ["https://vendor.example.com/vendor/register"] },
  "wholesale-application-received": { props: {}, expect: ["Application received"] },
  "wholesale-application-approved": { props: { business_name: "Greenleaf Nursery", contact_name: "Avery", tier_name: "Trade", payment_terms_days: 30 }, expect: ["Greenleaf Nursery"] },
  "wellness-automation": { props: { body: "Your session is tomorrow.", recipient_name: "Sam", practitioner_name: "River Wellness" }, expect: ["Your session is tomorrow.", "River Wellness"] },
  "plant-demand-activated": { props: { species_name: "Asclepias tuberosa", estimated_ship: "2027-04-01T00:00:00.000Z", price: 12.5, product_id: "prod_1" }, expect: ["Asclepias tuberosa"] },
}

describe("every email template renders with its caller's data", () => {
  it("has caller props for every template in the shared list", () => {
    expect(Object.keys(CALLER_PROPS).sort()).toEqual([...EMAIL_TEMPLATE_NAMES].sort())
  })

  it.each(EMAIL_TEMPLATE_NAMES.map((n) => [n]))("%s", async (name) => {
    const fixture = CALLER_PROPS[name]
    const out = await html(name, fixture.props)
    expect(out).toMatch(/^<!DOCTYPE html/i)
    for (const needle of fixture.expect) expect(out).toContain(needle)
  })
})

describe("order-placed", () => {
  it("prints a summary that adds up: Subtotal, shipping, Discount, Tax, Total", async () => {
    const out = await text("order-placed", taxedOrder)
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean)
    // Plain-text rendering upper-cases headings.
    const at = lines.findIndex((l) => /^order summary$/i.test(l))
    expect(at).toBeGreaterThan(-1)
    expect(lines.slice(at + 1, at + 11)).toEqual([
      "Subtotal",
      "$20.00",
      "Standard Shipping",
      "$8.00",
      "Discount",
      "-$5.00",
      "Tax",
      "$2.30",
      "Total",
      "$25.30",
    ])
    // The same lines the arithmetic spec checks, so what is drawn is what adds up.
    const summed = orderSummaryLines(taxedOrder.order).reduce((a, l) => a + l.amount, 0)
    expect(summed).toBeCloseTo(taxedOrder.order.total, 10)
    // Each item shows its pre-tax subtotal and quantity, adding up to Subtotal.
    expect(out).toContain("Qty 2")
  })

  it("carries no Medusa starter branding", async () => {
    const out = await html("order-placed", taxedOrder)
    expect(out.toLowerCase()).not.toContain("medusa")
    // The starter template's hexagon mark.
    expect(out).not.toContain("M16.2447 3.92183")
    expect(out).toContain("Free Black Market")
  })

  it("does not throw on a currency code Intl rejects", async () => {
    const out = await text("order-placed", { order: { ...taxedOrder.order, currency_code: "zz-bad" } })
    expect(out).toContain("25.30 ZZ-BAD")
  })
})

describe("templates that must not echo text a stranger chose", () => {
  it("wholesale-application-received renders none of the props it is given", async () => {
    const phish = "Your account is locked, verify at http://evil.example"
    const out = await html("wholesale-application-received", { business_name: phish, contact_name: phish })
    expect(out).not.toContain("evil.example")
    expect(out).not.toContain("locked")
  })

  it("wellness-automation renders the practitioner's text as text, never as HTML", async () => {
    const out = await html("wellness-automation", { body: "<script>alert(1)</script>", practitioner_name: "River" })
    expect(out).not.toContain("<script>")
    expect(out).toContain("&lt;script&gt;")
  })
})
