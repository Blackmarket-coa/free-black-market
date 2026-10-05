import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React, { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("@/lib/data/subscriptions", () => ({
  startSubscriptionCheckout: vi.fn(),
  approveAutoRenew: vi.fn(),
  disableAutoRenew: vi.fn(),
  cancelSubscription: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { Button } from "@/components/atoms/Button/Button"
import { AUTO_RENEW_DISCLOSURE_VERSION } from "@/lib/subscriptions/auto-renew"
import { SubscribeForm, SubscribeFormView } from "../SubscribeForm"
import { SubscriptionRowView } from "../SubscriptionsList"
import { SubscribeCta } from "../SubscribeCta"

/**
 * No DOM test environment in this workspace (see ConsentBanner.spec.tsx): the
 * stateful form is rendered through react-dom/server, and the hook-free views
 * are called as plain functions so their handlers can be invoked directly.
 */

const walk = (node: ReactNode, out: ReactElement[] = []): ReactElement[] => {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, out))
    return out
  }
  if (!isValidElement(node)) return out
  out.push(node)
  walk((node.props as { children?: ReactNode }).children, out)
  return out
}
const buttons = (root: ReactNode) => walk(root).filter((el) => el.type === Button)
const checkbox = (root: ReactNode) => {
  const el = walk(root).find(
    (e) => e.type === "input" && (e.props as { type?: string }).type === "checkbox"
  )
  if (!el) throw new Error("no checkbox")
  return el.props as { checked: boolean; onChange: (e: { target: { checked: boolean } }) => void }
}
type ButtonProps = { children: ReactNode; disabled?: boolean; onClick: () => void }

beforeEach(() => {
  vi.stubGlobal("React", React)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("subscribe step", () => {
  const viewProps = {
    productTitle: "Vault seat",
    price: "$10.00",
    interval: "monthly" as const,
    graceDays: null,
    submitting: false,
    error: null,
    onToggle: vi.fn(),
  }

  it("the auto-renew checkbox starts unticked", () => {
    const html = renderToStaticMarkup(
      <SubscribeForm
        productTitle="Vault seat"
        price="$10.00"
        interval="monthly"
        graceDays={null}
        variantId="variant_1"
        countryCode="us"
      />
    )
    expect(html).toContain('data-testid="auto-renew-checkbox"')
    expect(html).not.toMatch(/data-testid="auto-renew-checkbox"[^>]*checked/)
    expect(html).not.toMatch(/checked=""[^>]*data-testid="auto-renew-checkbox"/)
    expect(html).toContain("$10.00 per month")
    expect(html).toContain("renews every month until you cancel")
    expect(html).toContain("Cancel any time under Account → Subscriptions")
    // No grace length on the product: no read-only / export promise is made.
    expect(html).not.toMatch(/read-only|export your data/i)
    expect(html).toContain("can end your access sooner")
  })

  it("with a product grace length the days and the read-only step are stated, never export", () => {
    const tree = SubscribeFormView({ ...viewProps, graceDays: 14, autoRenewTicked: false, onSubmit: vi.fn() })
    const html = renderToStaticMarkup(tree)
    expect(html).toContain("plus 14 days")
    expect(html).toContain("read-only")
    expect(html).not.toMatch(/export/i)
  })

  it("unticked: the submit buys one period and carries no approval", () => {
    const onSubmit = vi.fn()
    const tree = SubscribeFormView({ ...viewProps, autoRenewTicked: false, onSubmit })
    const [submit] = buttons(tree)
    expect((submit.props as ButtonProps).children).toBe("Pay for one month")
    ;(submit.props as ButtonProps).onClick()
    expect(onSubmit).toHaveBeenCalledWith({
      interval: "monthly",
      auto_renew_approved: false,
      auto_renew_disclosure_version: null,
    })
  })

  it("ticked: only then does the submit carry the approval and the disclosure version", () => {
    const onSubmit = vi.fn()
    const onToggle = vi.fn()
    const unticked = SubscribeFormView({ ...viewProps, autoRenewTicked: false, onToggle, onSubmit })
    checkbox(unticked).onChange({ target: { checked: true } })
    expect(onToggle).toHaveBeenCalledWith(true)

    const ticked = SubscribeFormView({ ...viewProps, autoRenewTicked: true, onToggle, onSubmit })
    expect(checkbox(ticked).checked).toBe(true)
    const [submit] = buttons(ticked)
    expect((submit.props as ButtonProps).children).toBe("Subscribe — renews every month")
    ;(submit.props as ButtonProps).onClick()
    expect(onSubmit).toHaveBeenCalledWith({
      interval: "monthly",
      auto_renew_approved: true,
      auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
    })
  })
})

describe("account page toggle", () => {
  const handlers = () => ({
    onToggleApprove: vi.fn(),
    onDisable: vi.fn(),
    onApprove: vi.fn(),
    onCancel: vi.fn(),
  })
  const now = new Date("2026-10-10T00:00:00.000Z")
  const label = (b: ReactElement) => (b.props as ButtonProps).children

  it("auto-renew on: one click turns it off", () => {
    const h = handlers()
    const tree = SubscriptionRowView({
      subscription: {
        id: "sub_1",
        status: "active",
        interval: "monthly",
        next_order_date: "2026-11-01T00:00:00.000Z",
        expiration_date: null,
      },
      title: "Vault seat",
      price: "$10.00",
      approveTicked: false,
      busy: false,
      error: null,
      now,
      ...h,
    })
    const off = buttons(tree).find((b) => label(b) === "Turn off automatic renewal")
    expect(off).toBeDefined()
    ;(off!.props as ButtonProps).onClick()
    expect(h.onDisable).toHaveBeenCalledTimes(1)
    expect(buttons(tree).some((b) => label(b) === "Turn on automatic renewal")).toBe(false)
  })

  it("auto-renew off: turning it on is gated on ticking the current disclosure", () => {
    const h = handlers()
    const sub = {
      id: "sub_1",
      status: "active",
      interval: "monthly" as const,
      next_order_date: null,
      expiration_date: "2026-11-01T00:00:00.000Z",
      payment_method_id: "pm_1",
    }
    const base = { subscription: sub, title: "Vault seat", price: "$10.00", busy: false, error: null, now, ...h }

    const unticked = SubscriptionRowView({ ...base, approveTicked: false })
    const onBtn = buttons(unticked).find((b) => label(b) === "Turn on automatic renewal")!
    expect((onBtn.props as ButtonProps).disabled).toBe(true)
    expect(checkbox(unticked).checked).toBe(false)
    checkbox(unticked).onChange({ target: { checked: true } })
    expect(h.onToggleApprove).toHaveBeenCalledWith(true)

    // The re-approval wording, not the purchase one: nothing charged today.
    const html = renderToStaticMarkup(unticked)
    expect(html).toContain("Nothing is charged today")
    expect(html).not.toContain("you pay with today")

    const ticked = SubscriptionRowView({ ...base, approveTicked: true })
    const enabled = buttons(ticked).find((b) => label(b) === "Turn on automatic renewal")!
    expect((enabled.props as ButtonProps).disabled).toBe(false)
    ;(enabled.props as ButtonProps).onClick()
    expect(h.onApprove).toHaveBeenCalledTimes(1)
  })

  it("grace with a final charge scheduled: says so, points to cancel, never 'no further charges'", () => {
    const h = handlers()
    const tree = SubscriptionRowView({
      subscription: {
        id: "sub_1",
        status: "past_due",
        interval: "monthly",
        expiration_date: null,
        next_order_date: "2026-10-20T00:00:00.000Z",
        grace_ends_at: "2026-10-20T00:00:00.000Z",
      },
      title: "Vault seat",
      price: "$10.00",
      approveTicked: false,
      busy: false,
      error: null,
      now,
      ...h,
    })
    const html = renderToStaticMarkup(tree)
    expect(html).toContain("Final payment attempt:")
    expect(html).not.toContain("No further charges")
    expect(html).not.toContain("Automatic renewal: off")
    const cancel = buttons(tree).find((b) => label(b) === "Cancel subscription")
    expect(cancel).toBeDefined()
  })

  it("cancel is offered for a running subscription", () => {
    const h = handlers()
    const tree = SubscriptionRowView({
      subscription: { id: "sub_1", status: "active", interval: "monthly", expiration_date: null },
      title: "Vault seat",
      price: null,
      approveTicked: false,
      busy: false,
      error: null,
      now,
      ...h,
    })
    const cancel = buttons(tree).find((b) => label(b) === "Cancel subscription")!
    ;(cancel.props as ButtonProps).onClick()
    expect(h.onCancel).toHaveBeenCalledTimes(1)
  })
})

describe("flag off: nothing new renders", () => {
  const marked = {
    handle: "vault-seat",
    metadata: { subscription_until_canceled: true, subscription_interval: "monthly" },
  }

  it("the product-page CTA renders nothing with the flag at its default", () => {
    expect(SubscribeCta({ product: marked })).toBeNull()
  })

  it("flag on: the CTA appears only for a marked product", () => {
    expect(SubscribeCta({ product: marked, flagOn: true })).not.toBeNull()
    expect(SubscribeCta({ product: { handle: "x", metadata: {} }, flagOn: true })).toBeNull()
  })
})
