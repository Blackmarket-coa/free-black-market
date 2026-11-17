import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * What the cart page's promotion field tells the buyer.
 *
 * Measured by the checkout scout: a free-shipping code entered here comes
 * back `200` with `promotions: []`. Medusa keeps a code on the cart only when
 * it took something off the cart as it is, and on this page no delivery
 * option is chosen yet. The buyer was told "Promotion code not found" about a
 * code that exists. A code the backend does not know was refused and the
 * buyer was told nothing: the error went to the log only.
 *
 * A server render with the code already typed (the input's state starts at
 * it) and the button's click handler kept, as the checkout specs beside this
 * one do: no DOM library here.
 */

const h = vi.hoisted(() => ({
  applyPromotions: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  apply: undefined as undefined | (() => Promise<unknown>),
}))

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  return {
    ...actual,
    // The code field's state starts with a code typed in it.
    useState: (initial: unknown) => actual.useState(initial === "" ? "FREESHIP" : initial),
  }
})
vi.mock("@/lib/data/cart", () => ({ applyPromotions: h.applyPromotions }))
vi.mock("@/lib/helpers/toast", () => ({ toast: h.toast }))
// Reached only through the atoms barrel (LogoutButton); a server action.
vi.mock("@/lib/data/customer", () => ({ signout: vi.fn() }))
vi.mock("@/components/atoms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/atoms")>()
  const { createElement } = await import("react")
  return {
    ...actual,
    Button: (props: React.ComponentProps<typeof actual.Button>) => {
      if (props.children === "Use promotion code") h.apply = props.onClick as unknown as () => Promise<unknown>
      return createElement(actual.Button, props)
    },
  }
})

// The storefront's vitest compiles JSX to the classic `React.createElement`.
;(globalThis as { React?: typeof React }).React = React

let CartPromotionCode: typeof import("../CartReview/CartPromotionCode").default

beforeAll(async () => {
  CartPromotionCode = (await import("../CartReview/CartPromotionCode")).default
})

beforeEach(() => {
  vi.clearAllMocks()
  h.apply = undefined
})

async function applyTheCode() {
  renderToStaticMarkup(<CartPromotionCode cart={null} />)
  expect(h.apply).toBeInstanceOf(Function)
  await h.apply?.()
  expect(h.applyPromotions).toHaveBeenCalledWith(["FREESHIP"])
}

describe("the cart page's promotion code", () => {
  it("says a known code that took nothing off the cart does not apply, not that it was not found", async () => {
    h.applyPromotions.mockResolvedValue(false)

    await applyTheCode()

    expect(h.toast.success).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledTimes(1)
    const [{ title }] = h.toast.error.mock.calls[0]
    expect(title).toBe("This code doesn't apply to your cart")
    expect(title).not.toMatch(/not found/i)
  })

  it("tells the buyer when the code is refused, instead of only logging it", async () => {
    h.applyPromotions.mockRejectedValue(new Error("The promotion code FREESHIP is invalid."))

    await applyTheCode()

    expect(h.toast.error).toHaveBeenCalledWith({
      title: "We couldn't apply that code",
      description: "Check the code and try again.",
    })
  })

  it("confirms a code that applied", async () => {
    h.applyPromotions.mockResolvedValue(true)

    await applyTheCode()

    expect(h.toast.success).toHaveBeenCalledWith({ title: "Promotion code applied" })
    expect(h.toast.error).not.toHaveBeenCalled()
  })
})
