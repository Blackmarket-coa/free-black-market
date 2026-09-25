"use client"

import Link from "next/link"
import { useEffect, useRef, useState, type Ref } from "react"
import { Button } from "@/components/atoms/Button/Button"
import { PRIVACY_POLICY_PATH } from "@/lib/constants/legal"
import {
  CONSENT_RESET_EVENT,
  setConsent,
  type ConsentChoice,
} from "@/lib/consent"

/**
 * CSS custom property holding the banner's height while it is shown. The
 * body pads its end by it, so the last of the page can scroll clear of the
 * banner, and the fixed bottom controls (BackToTop, the mobile
 * RadialLauncher, MobileStickyAddToCart) add it to their bottom offset so the
 * banner never covers them.
 */
export const CONSENT_OFFSET_VAR = "--fbm-consent-offset"

type RootStyle = {
  scrollPaddingBottom: string
  getPropertyValue(name: string): string
  setProperty(name: string, value: string): void
  removeProperty(name: string): string
}

/**
 * Reserve `px` at the bottom of the page for the banner and return the
 * function that gives the previous values back.
 *
 * The banner is fixed over the bottom of the viewport, and a browser scrolls
 * a newly focused element into view without knowing that. Tabbing through the
 * page could therefore land focus on a link the banner hides completely
 * (WCAG 2.2, 2.4.11 Focus Not Obscured). Scroll padding on the root is what
 * the browser does consult when it scrolls focus into view; the offset
 * variable does the same for controls that are themselves fixed.
 */
export function reserveBannerSpace(
  root: { style: RootStyle },
  px: number
): () => void {
  const value = `${Math.ceil(px)}px`
  const previousPadding = root.style.scrollPaddingBottom
  const previousOffset = root.style.getPropertyValue(CONSENT_OFFSET_VAR)
  root.style.scrollPaddingBottom = value
  root.style.setProperty(CONSENT_OFFSET_VAR, value)
  return () => {
    root.style.scrollPaddingBottom = previousPadding
    if (previousOffset)
      root.style.setProperty(CONSENT_OFFSET_VAR, previousOffset)
    else root.style.removeProperty(CONSENT_OFFSET_VAR)
  }
}

type BannerObserver<T> = new (callback: () => void) => {
  observe(target: T): void
  disconnect(): void
}

/**
 * Hold the banner's space for as long as it is shown: reserve its current
 * height now, follow it as it resizes (the card wraps onto more lines on a
 * narrow viewport), and return the cleanup that stops following and gives
 * the space back. `Observer` is `ResizeObserver` where the browser has one.
 */
export function holdBannerSpace<
  T extends { getBoundingClientRect(): { height: number } },
>(
  root: { style: RootStyle },
  region: T,
  Observer: BannerObserver<T> | undefined
): () => void {
  let restore = () => {}
  const reserve = () => {
    restore()
    restore = reserveBannerSpace(root, region.getBoundingClientRect().height)
  }
  reserve()

  const observer = Observer ? new Observer(reserve) : null
  observer?.observe(region)

  return () => {
    observer?.disconnect()
    restore()
  }
}

/**
 * Presentational half of the banner. Hook-free so it can be exercised as a
 * plain function in tests: the buttons write the cookie themselves and then
 * report the choice upwards.
 */
export function ConsentBannerView({
  onChosen,
  regionRef,
}: {
  onChosen: (choice: ConsentChoice) => void
  regionRef?: Ref<HTMLElement>
}) {
  const choose = (choice: ConsentChoice) => {
    setConsent(choice)
    onChosen(choice)
  }

  return (
    <section
      ref={regionRef}
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 p-4 pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-3xl border rounded-sm bg-primary shadow-solarpunk-sm p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="label-md text-secondary">
          {
            "We use essential cookies to run the store, and optional cookies to credit creators and measure how the site is used — see our "
          }
          <Link href={PRIVACY_POLICY_PATH} className="underline">
            Privacy Policy
          </Link>
          {"."}
        </p>
        <div className="flex gap-2 shrink-0">
          <Button
            type="button"
            variant="tonal"
            className="uppercase"
            onClick={() => choose("essential")}
          >
            Only essential
          </Button>
          <Button
            type="button"
            className="uppercase"
            onClick={() => choose("accepted")}
          >
            Accept
          </Button>
        </div>
      </div>
    </section>
  )
}

/**
 * Cookie-consent banner (LEG-8). Mounted once in the root layout.
 *
 * `initialConsent` is read from the cookie on the server so a returning
 * visitor gets `null` markup from the first byte — the banner never flashes
 * for someone who already chose. It re-shows when the footer's
 * "Cookie settings" link clears the cookie and fires `CONSENT_RESET_EVENT`.
 *
 * While shown it reserves its own height at the bottom of the page (see
 * `holdBannerSpace`), and gives that space back once a choice is made. When
 * "Cookie settings" re-opens it, focus moves to its first button.
 */
export function ConsentBanner({
  initialConsent,
}: {
  initialConsent: ConsentChoice | null
}) {
  const [choice, setChoice] = useState<ConsentChoice | null>(initialConsent)
  const regionRef = useRef<HTMLElement>(null)
  const focusOnShow = useRef(false)

  useEffect(() => {
    const onReset = () => {
      focusOnShow.current = true
      setChoice(null)
    }
    window.addEventListener(CONSENT_RESET_EVENT, onReset)
    return () => window.removeEventListener(CONSENT_RESET_EVENT, onReset)
  }, [])

  useEffect(() => {
    const region = regionRef.current
    if (choice || !region) return

    const release = holdBannerSpace(
      document.documentElement,
      region,
      typeof ResizeObserver === "function" ? ResizeObserver : undefined
    )

    // Re-opened from "Cookie settings" in the footer: the banner is first in
    // the page, so without this a keyboard or screen-reader user would have
    // to travel round the whole document to reach the choice.
    if (focusOnShow.current) {
      focusOnShow.current = false
      region.querySelector<HTMLElement>("button")?.focus()
    }

    return release
  }, [choice])

  if (choice) return null

  return <ConsentBannerView onChosen={setChoice} regionRef={regionRef} />
}
