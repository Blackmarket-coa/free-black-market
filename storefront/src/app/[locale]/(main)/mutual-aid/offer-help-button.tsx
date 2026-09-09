"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { matchAidRequest } from "@/lib/data/mutual-aid"

/**
 * Take a request on.
 *
 * First-come, decided server-side by a `status = 'OPEN'` predicate — so the
 * refusal below is the honest outcome of a race, not an error, and it says so
 * rather than showing a failure. Someone waiting on aid who is told twice that
 * help is coming, and then gets none, is worse off than one never matched.
 *
 * The success message carries no contact details because the API returns none:
 * it hands back a `next_step` string pointing at chat instead.
 */
export default function OfferHelpButton({ requestId }: { requestId: string }) {
  const router = useRouter()
  const [state, setState] = useState<"idle" | "sending" | "taken" | "gone" | "error">("idle")
  const [message, setMessage] = useState("")

  async function offerHelp() {
    setState("sending")
    setMessage("")

    try {
      const result = await matchAidRequest(requestId)
      setState("taken")
      setMessage(result.next_step || "Message them to arrange the details.")
      router.refresh()
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not take this on."
      // Someone else got there first. That is the system working.
      if (/already been matched/i.test(text)) {
        setState("gone")
        router.refresh()
        return
      }
      setState("error")
      setMessage(
        /sign(ed)? in|unauthor/i.test(text)
          ? "Sign in to offer help."
          : text
      )
    }
  }

  if (state === "taken") {
    return (
      <p className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800">
        You have taken this on. {message}
      </p>
    )
  }

  if (state === "gone") {
    return (
      <p className="mt-3 text-xs text-ui-fg-subtle">
        Someone else got there first.
      </p>
    )
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={offerHelp}
        disabled={state === "sending"}
        data-testid="offer-help"
        className="rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
      >
        {state === "sending" ? "Taking it on…" : "I can help"}
      </button>
      {state === "error" ? (
        <p className="mt-2 text-xs text-red-700">{message}</p>
      ) : null}
    </div>
  )
}
