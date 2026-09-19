import { useEffect, useMemo, useRef } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Spinner } from "@medusajs/icons"
import { Button, Heading, Text } from "@medusajs/ui"

import { useVerifySellerEmail } from "../../hooks/api/auth"

/**
 * The landing page for the seller email-verification link.
 *
 * Registration issues a single-use token and mails
 * `${VENDOR_PANEL_URL}/verify-email?request=..&token=..`. Approval is automatic
 * on the backend, so opening this link IS the moment a store is created — there
 * is nothing else to wait for and no admin in the loop.
 *
 * Deliberately anonymous: the person following this link has no account to log
 * in with yet, which is the whole point of the step.
 */

type Shell = { children: React.ReactNode }

const Page = ({ children }: Shell) => (
  <div className="bg-ui-bg-subtle flex min-h-dvh w-dvw items-center justify-center px-4 py-10">
    <div className="w-full max-w-md">
      <div className="bg-ui-bg-base shadow-elevation-card-rest border-ui-border-base flex flex-col items-center rounded-2xl border p-6 text-center sm:p-8">
        {children}
      </div>
    </div>
  </div>
)

const SuccessMark = () => (
  <div className="bg-ui-tag-green-bg mb-4 flex h-16 w-16 items-center justify-center rounded-full">
    <svg
      className="text-ui-tag-green-icon h-8 w-8"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  </div>
)

const ProblemMark = () => (
  <div className="bg-ui-tag-red-bg mb-4 flex h-16 w-16 items-center justify-center rounded-full">
    <svg
      className="text-ui-tag-red-icon h-8 w-8"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  </div>
)

export const VerifyEmail = () => {
  const [searchParams] = useSearchParams()
  const request = searchParams.get("request")
  const token = searchParams.get("token")
  const params = useMemo(
    () => (request && token ? { request, token } : null),
    [request, token]
  )

  const { mutate, isPending, isSuccess, isError } = useVerifySellerEmail()

  // The token is single-use and burned server-side before approval runs, so a
  // second submit would always fail. React 18 StrictMode double-invokes effects
  // in development, which would do exactly that and show every developer a
  // spurious failure, so the send is guarded rather than keyed on the effect.
  const sent = useRef(false)
  useEffect(() => {
    if (!params || sent.current) {
      return
    }
    sent.current = true
    mutate(params)
  }, [params, mutate])

  if (!params) {
    return (
      <Page>
        <ProblemMark />
        <Heading>That link is incomplete</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-2 max-w-[320px]">
          Open the verification link from your email exactly as it was sent.
          Some mail clients split long links across lines.
        </Text>
        <Link to="/register">
          <Button className="mt-8" variant="secondary">
            Register again
          </Button>
        </Link>
      </Page>
    )
  }

  if (isPending) {
    return (
      <Page>
        <Spinner className="text-ui-fg-interactive mb-4 h-8 w-8 animate-spin" />
        <Heading>Confirming your email</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-2 max-w-[320px]">
          This only takes a moment.
        </Text>
      </Page>
    )
  }

  if (isSuccess) {
    return (
      <Page>
        <SuccessMark />
        <Heading>Your store is open</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-2 max-w-[320px]">
          Your email is confirmed and your seller account is approved. Sign in
          to finish setting up.
        </Text>
        <Link to="/login">
          <Button className="mt-8">Sign in</Button>
        </Link>
      </Page>
    )
  }

  if (isError) {
    return (
      <Page>
        <ProblemMark />
        <Heading>That link is no longer valid</Heading>
        {/* The backend answers every failure identically on purpose, so that a
            stranger cannot use this page to discover which registrations exist
            or are still open. We cannot say more here than it tells us. */}
        <Text size="small" className="text-ui-fg-subtle mt-2 max-w-[320px]">
          Verification links can only be used once, and they expire after 24
          hours. If you have already confirmed, just sign in. Otherwise register
          again and we will send a new link.
        </Text>
        <div className="mt-8 flex gap-3">
          <Link to="/login">
            <Button variant="secondary">Sign in</Button>
          </Link>
          <Link to="/register">
            <Button>Register again</Button>
          </Link>
        </div>
      </Page>
    )
  }

  return (
    <Page>
      <Spinner className="text-ui-fg-interactive mb-4 h-8 w-8 animate-spin" />
      <Heading>Confirming your email</Heading>
    </Page>
  )
}
