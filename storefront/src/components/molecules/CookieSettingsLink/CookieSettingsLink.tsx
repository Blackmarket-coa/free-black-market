"use client"

import { clearConsent, CONSENT_RESET_EVENT } from "@/lib/consent"

/**
 * Footer control that forgets the visitor's cookie choice and asks the
 * consent banner to show again. A button rather than a link because it
 * changes state instead of navigating; styled to sit among the legal links.
 */
export function CookieSettingsLink({ className }: { className?: string }) {
  const reopen = () => {
    clearConsent()
    window.dispatchEvent(new Event(CONSENT_RESET_EVENT))
  }

  return (
    <button type="button" onClick={reopen} className={className}>
      Cookie settings
    </button>
  )
}
