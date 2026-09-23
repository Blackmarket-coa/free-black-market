"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/atoms/Button/Button"
import { PRIVACY_POLICY_PATH } from "@/lib/constants/legal"
import {
  CONSENT_RESET_EVENT,
  setConsent,
  type ConsentChoice,
} from "@/lib/consent"

/**
 * Presentational half of the banner. Hook-free so it can be exercised as a
 * plain function in tests: the buttons write the cookie themselves and then
 * report the choice upwards.
 */
export function ConsentBannerView({
  onChosen,
}: {
  onChosen: (choice: ConsentChoice) => void
}) {
  const choose = (choice: ConsentChoice) => {
    setConsent(choice)
    onChosen(choice)
  }

  return (
    <section
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
 */
export function ConsentBanner({
  initialConsent,
}: {
  initialConsent: ConsentChoice | null
}) {
  const [choice, setChoice] = useState<ConsentChoice | null>(initialConsent)

  useEffect(() => {
    const onReset = () => setChoice(null)
    window.addEventListener(CONSENT_RESET_EVENT, onReset)
    return () => window.removeEventListener(CONSENT_RESET_EVENT, onReset)
  }, [])

  if (choice) return null

  return <ConsentBannerView onChosen={setChoice} />
}
