"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/atoms"
import { sellerLogin } from "@/lib/data/vendor-auth"
import { VENDOR_PANEL_URL } from "@/const"

/**
 * Vendor sign-in for the in-app surface.
 *
 * This is a separate credential from the shopper session on purpose — a
 * seller account has no shopper profile, which is exactly why shopper
 * login bounces it. Signing in here stores a seller token in an httpOnly
 * cookie; it never reaches this component.
 */
export const VendorSignIn = () => {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const onSubmit = (formData: FormData) => {
    setError(null)
    startTransition(async () => {
      const result = await sellerLogin({
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      })
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="max-w-md mx-auto py-6">
      <h1 className="heading-md mb-2">Vendor sign in</h1>
      <p className="label-md text-secondary mb-6">
        Sign in with your vendor account to see orders that need you and mark
        them shipped or delivered.
      </p>

      <form action={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="label-md">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="border rounded-sm p-3 bg-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label-md">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="border rounded-sm p-3 bg-primary"
          />
        </label>

        {error ? (
          <p className="label-md text-negative" role="alert">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          loading={pending}
          disabled={pending}
          className="w-full py-3 flex justify-center items-center"
        >
          Sign in
        </Button>
      </form>

      <p className="label-md text-secondary mt-6">
        Managing products, payouts or returns?{" "}
        <a
          href={VENDOR_PANEL_URL}
          className="underline"
          target="_blank"
          rel="noreferrer noopener"
        >
          Open the full vendor dashboard
        </a>
        .
      </p>
    </div>
  )
}
