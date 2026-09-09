"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  withdrawAidOffer,
  withdrawAidRequest,
  type OwnAidPost,
} from "@/lib/data/mutual-aid"

/**
 * Your own asks and offers.
 *
 * This section is why `/mine` exists. The public projection withholds
 * `requester_id`, correctly, and that also meant nothing ever gave a person
 * back the id of the row they posted — so the withdraw endpoint existed with no
 * way for a human to reach it.
 *
 * Every status is listed, not just the open ones: a withdrawn or expired ask
 * that simply disappeared would read as lost rather than closed.
 */
const TERMINAL = new Set(["FULFILLED", "WITHDRAWN", "EXPIRED", "SPENT"])

const LABELS: Record<string, string> = {
  OPEN: "Open",
  MATCHED: "Someone is helping",
  FULFILLED: "Done",
  WITHDRAWN: "You took this down",
  EXPIRED: "Passed its date",
  AVAILABLE: "Open",
  COMMITTED: "Promised to someone",
  SPENT: "Given",
}

export default function MyAidPosts({
  requests,
  offers,
}: {
  requests: OwnAidPost[]
  offers: OwnAidPost[]
}) {
  if (requests.length === 0 && offers.length === 0) return null

  return (
    <section
      data-testid="my-aid-posts"
      className="mb-8 rounded-md border bg-ui-bg-subtle p-5"
    >
      <h2 className="mb-3 font-medium">Yours</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <OwnColumn
          heading="Asked for"
          posts={requests}
          withdraw={withdrawAidRequest}
        />
        <OwnColumn heading="Offered" posts={offers} withdraw={withdrawAidOffer} />
      </div>
    </section>
  )
}

function OwnColumn({
  heading,
  posts,
  withdraw,
}: {
  heading: string
  posts: OwnAidPost[]
  withdraw: (id: string) => Promise<unknown>
}) {
  if (posts.length === 0) return null

  return (
    <div>
      <h3 className="mb-2 text-xs uppercase text-ui-fg-subtle">{heading}</h3>
      <ul className="grid gap-2">
        {posts.map((post) => (
          <OwnPostRow key={post.id} post={post} withdraw={withdraw} />
        ))}
      </ul>
    </div>
  )
}

function OwnPostRow({
  post,
  withdraw,
}: {
  post: OwnAidPost
  withdraw: (id: string) => Promise<unknown>
}) {
  const router = useRouter()
  const [state, setState] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState("")

  // A COMMITTED offer is a promise already made to a named person waiting on
  // it, so the server refuses to withdraw one. Not offering the button is
  // clearer than offering it and explaining a 409.
  const canWithdraw = !TERMINAL.has(post.status) && post.status !== "COMMITTED"

  async function takeItDown() {
    setState("saving")
    setError("")
    try {
      await withdraw(post.id)
      router.refresh()
      setState("idle")
    } catch (err) {
      setState("error")
      setError(err instanceof Error ? err.message : "Could not take it down.")
    }
  }

  return (
    <li className="rounded-md border bg-ui-bg-base p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{post.title}</p>
          <p className="text-xs text-ui-fg-subtle">
            {LABELS[post.status] ?? post.status}
            {post.locality ? ` · ${post.locality}` : ""}
            {post.urgency && post.urgency !== "ROUTINE"
              ? ` · ${post.urgency.toLowerCase()}`
              : ""}
          </p>
        </div>
        {canWithdraw ? (
          <button
            type="button"
            onClick={takeItDown}
            disabled={state === "saving"}
            data-testid={`withdraw-${post.id}`}
            className="shrink-0 rounded-md border px-2 py-1 text-xs disabled:opacity-60"
          >
            {state === "saving" ? "…" : "Take it down"}
          </button>
        ) : null}
      </div>
      {state === "error" ? (
        <p className="mt-2 text-xs text-red-700">{error}</p>
      ) : null}
    </li>
  )
}
