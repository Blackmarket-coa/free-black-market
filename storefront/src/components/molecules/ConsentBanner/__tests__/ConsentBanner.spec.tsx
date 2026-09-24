import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React, { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { Button } from "@/components/atoms/Button/Button"
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS } from "@/lib/consent"
import { PRIVACY_POLICY_PATH } from "@/lib/constants/legal"

import {
  ConsentBanner,
  ConsentBannerView,
  CONSENT_OFFSET_VAR,
  holdBannerSpace,
  reserveBannerSpace,
} from "../ConsentBanner"

/**
 * There is no DOM test environment in this workspace, so the stateful banner
 * is checked through `react-dom/server` (the same renderer the root layout
 * uses for the first paint) and the hook-free view is called as a plain
 * function so its button handlers can be invoked directly.
 */

const stubDocument = () => {
  const writes: string[] = []
  vi.stubGlobal("document", {
    get cookie() {
      return ""
    },
    set cookie(value: string) {
      writes.push(value)
    },
  })
  vi.stubGlobal("location", { protocol: "https:" })
  return writes
}

const collectButtons = (
  node: ReactNode,
  out: ReactElement[] = []
): ReactElement[] => {
  if (Array.isArray(node)) {
    node.forEach((child) => collectButtons(child, out))
    return out
  }
  if (!isValidElement(node)) return out
  const props = node.props as { children?: ReactNode }
  if (node.type === Button || node.type === "button") out.push(node)
  collectButtons(props.children, out)
  return out
}

const buttonLabelled = (root: ReactNode, label: string) => {
  const match = collectButtons(root).find(
    (el) => (el.props as { children?: ReactNode }).children === label
  )
  if (!match) throw new Error(`no button labelled ${label}`)
  return match.props as { onClick: () => void }
}

beforeEach(() => {
  // Vitest compiles JSX with the classic runtime here, so components that do
  // not import React themselves (the atoms) need it in scope to render.
  vi.stubGlobal("React", React)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ConsentBanner", () => {
  it("renders the region only when no choice is stored", () => {
    const html = renderToStaticMarkup(<ConsentBanner initialConsent={null} />)

    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Cookie consent"')
    expect(html).toContain(`href="${PRIVACY_POLICY_PATH}"`)
    expect(html).toContain("Accept")
    expect(html).toContain("Only essential")
  })

  it("renders nothing for a visitor who already chose", () => {
    expect(
      renderToStaticMarkup(<ConsentBanner initialConsent="accepted" />)
    ).toBe("")
    expect(
      renderToStaticMarkup(<ConsentBanner initialConsent="essential" />)
    ).toBe("")
  })

  it("exposes two focusable buttons", () => {
    const html = renderToStaticMarkup(<ConsentBanner initialConsent={null} />)

    expect(html.match(/<button\b[^>]*type="button"/g)).toHaveLength(2)
    expect(html).not.toMatch(/<button\b[^>]*\sdisabled[\s=>]/)
    expect(html).not.toContain('tabindex="-1"')
  })
})

describe("ConsentBannerView buttons", () => {
  it("Accept writes fbm_consent=accepted and reports the choice", () => {
    const writes = stubDocument()
    const onChosen = vi.fn()

    buttonLabelled(ConsentBannerView({ onChosen }), "Accept").onClick()

    expect(writes).toEqual([
      `${CONSENT_COOKIE}=accepted; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`,
    ])
    expect(onChosen).toHaveBeenCalledWith("accepted")
  })

  it("Only essential writes fbm_consent=essential and reports the choice", () => {
    const writes = stubDocument()
    const onChosen = vi.fn()

    buttonLabelled(ConsentBannerView({ onChosen }), "Only essential").onClick()

    expect(writes).toEqual([
      `${CONSENT_COOKIE}=essential; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`,
    ])
    expect(onChosen).toHaveBeenCalledWith("essential")
  })
})

const styleStub = (padding: string, props: Record<string, string> = {}) => {
  const vars = new Map(Object.entries(props))
  return {
    vars,
    style: {
      scrollPaddingBottom: padding,
      getPropertyValue: (name: string) => vars.get(name) ?? "",
      setProperty: (name: string, value: string) => void vars.set(name, value),
      removeProperty: (name: string) => {
        const had = vars.get(name) ?? ""
        vars.delete(name)
        return had
      },
    },
  }
}

describe("reserveBannerSpace", () => {
  it("reserves the banner height and gives the previous values back", () => {
    const root = styleStub("8px")

    const restore = reserveBannerSpace(root, 151.2)

    // Rounded up, so a fractional height never leaves a sliver covered.
    expect(root.style.scrollPaddingBottom).toBe("152px")
    expect(root.vars.get(CONSENT_OFFSET_VAR)).toBe("152px")
    restore()
    expect(root.style.scrollPaddingBottom).toBe("8px")
    expect(root.vars.has(CONSENT_OFFSET_VAR)).toBe(false)
  })

  it("restores an offset that was already set", () => {
    const root = styleStub("", { [CONSENT_OFFSET_VAR]: "40px" })

    reserveBannerSpace(root, 100)()

    expect(root.vars.get(CONSENT_OFFSET_VAR)).toBe("40px")
  })
})

describe("holdBannerSpace", () => {
  class FakeObserver {
    static last: FakeObserver | null = null
    observed: unknown[] = []
    disconnected = false
    constructor(readonly fire: () => void) {
      FakeObserver.last = this
    }
    observe(target: unknown) {
      this.observed.push(target)
    }
    disconnect() {
      this.disconnected = true
    }
  }

  it("follows the banner as it resizes and gives everything back", () => {
    const root = styleStub("8px")
    let height = 110.4
    const region = { getBoundingClientRect: () => ({ height }) }

    const release = holdBannerSpace(root, region, FakeObserver)
    const observer = FakeObserver.last!

    expect(observer.observed).toEqual([region])
    expect(root.style.scrollPaddingBottom).toBe("111px")

    // The card wraps onto more lines; the observer may fire more than once.
    height = 183.6
    observer.fire()
    observer.fire()
    expect(root.style.scrollPaddingBottom).toBe("184px")
    expect(root.vars.get(CONSENT_OFFSET_VAR)).toBe("184px")

    release()
    expect(observer.disconnected).toBe(true)
    expect(root.style.scrollPaddingBottom).toBe("8px")
    expect(root.vars.has(CONSENT_OFFSET_VAR)).toBe(false)
  })

  it("still reserves and releases without ResizeObserver", () => {
    const root = styleStub("")
    const region = { getBoundingClientRect: () => ({ height: 90 }) }

    const release = holdBannerSpace(root, region, undefined)
    expect(root.vars.get(CONSENT_OFFSET_VAR)).toBe("90px")

    release()
    expect(root.style.scrollPaddingBottom).toBe("")
    expect(root.vars.has(CONSENT_OFFSET_VAR)).toBe(false)
  })
})
