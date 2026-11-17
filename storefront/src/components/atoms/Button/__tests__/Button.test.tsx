import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Button } from "../Button"

/**
 * A loading button takes no click. "Place order" showed its spinner while the
 * order was being placed and still took a second click, which sent a second
 * completion of the same cart: one request gets the order set, the other a
 * 500 "Transaction already started" from Mercur's route (measured in the
 * SD-147 review, open item (e)).
 */

// The storefront's vitest compiles JSX to the classic `React.createElement`.
;(globalThis as { React?: typeof React }).React = React

describe("Button", () => {
  it("is disabled, and says it is busy, while loading", () => {
    const html = renderToStaticMarkup(<Button loading>Place order</Button>)

    expect(html).toMatch(/<button[^>]* disabled=""/)
    expect(html).toContain('aria-busy="true"')
  })

  it("is disabled while loading even when the caller says it is not", () => {
    expect(renderToStaticMarkup(<Button loading disabled={false}>Place order</Button>)).toMatch(/ disabled=""/)
  })

  it("takes clicks when it is neither loading nor disabled", () => {
    const html = renderToStaticMarkup(<Button>Place order</Button>)

    expect(html).not.toMatch(/ disabled=""/)
    expect(html).not.toContain("aria-busy")
    expect(html).toContain("Place order")
  })

  it("stays disabled when the caller disables it", () => {
    expect(renderToStaticMarkup(<Button disabled>Place order</Button>)).toMatch(/ disabled=""/)
  })
})
