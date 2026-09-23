import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React, { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { Button } from "@/components/atoms/Button/Button"
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS } from "@/lib/consent"
import { PRIVACY_POLICY_PATH } from "@/lib/constants/legal"

import { ConsentBanner, ConsentBannerView } from "../ConsentBanner"

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
