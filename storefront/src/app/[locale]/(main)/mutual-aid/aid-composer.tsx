"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createAidOffer, createAidRequest } from "@/lib/data/mutual-aid"

/**
 * Post an ask or an offer.
 *
 * One deliberate omission: there is no location field beyond `locality`. The
 * API accepts latitude and longitude and this form does not collect them —
 * demanding a position from someone asking for help, to make matching tidier,
 * is the wrong trade, and the board could only ever show the coarse label
 * anyway.
 *
 * `urgency` is on the request side only, and the field says plainly that it is
 * not published. A board that ranked strangers' needs by urgency would reward
 * overstating it; it is here because the poster's own view shows it back and
 * the matching engine may use it later.
 */
const CATEGORIES = [
  "food",
  "transport",
  "childcare",
  "eldercare",
  "housing",
  "materials",
  "repairs",
  "other",
]

type Mode = "request" | "offer"

export default function AidComposer() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>("request")
  const [state, setState] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState("")

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState("saving")
    setError("")

    const form = new FormData(event.currentTarget)
    const title = String(form.get("title") || "").trim()
    const description = String(form.get("description") || "").trim()

    if (!title || !description) {
      setState("error")
      setError("A title and a description are both needed.")
      return
    }

    const category = String(form.get("category") || "").trim() || undefined
    const locality = String(form.get("locality") || "").trim() || undefined
    const quantityRaw = String(form.get("quantity") || "").trim()
    const quantity = quantityRaw ? Number(quantityRaw) : undefined
    const unit_of_measure = String(form.get("unit_of_measure") || "").trim() || undefined

    if (quantity !== undefined && (!Number.isInteger(quantity) || quantity <= 0)) {
      setState("error")
      setError("How many must be a whole number above zero.")
      return
    }

    try {
      if (mode === "request") {
        const urgency = String(form.get("urgency") || "ROUTINE") as
          | "ROUTINE"
          | "SOON"
          | "URGENT"
        await createAidRequest({
          title,
          description,
          category,
          locality,
          quantity,
          unit_of_measure,
          urgency,
        })
      } else {
        await createAidOffer({
          title,
          description,
          category,
          locality,
          quantity,
          unit_of_measure,
        })
      }

      setState("idle")
      setOpen(false)
      router.refresh()
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not post that."
      setState("error")
      setError(
        /sign(ed)? in|unauthor/i.test(text) ? "Sign in to post to the board." : text
      )
    }
  }

  if (!open) {
    return (
      <div className="mt-8 flex gap-2">
        <button
          type="button"
          data-testid="open-ask"
          onClick={() => {
            setMode("request")
            setOpen(true)
          }}
          className="rounded-md bg-primary px-4 py-2 text-sm text-white"
        >
          Ask for something
        </button>
        <button
          type="button"
          data-testid="open-offer"
          onClick={() => {
            setMode("offer")
            setOpen(true)
          }}
          className="rounded-md border px-4 py-2 text-sm font-medium"
        >
          Offer something
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      data-testid="aid-composer"
      className="mt-8 grid gap-3 rounded-md border p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">
          {mode === "request" ? "Ask for something" : "Offer something"}
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs underline"
        >
          Cancel
        </button>
      </div>

      <label className="grid gap-1 text-sm">
        <span>What is it?</span>
        <input
          name="title"
          required
          maxLength={140}
          className="rounded-md border px-3 py-2"
          placeholder={
            mode === "request"
              ? "A ride to a dialysis appointment"
              : "A spare chest freezer"
          }
        />
      </label>

      <label className="grid gap-1 text-sm">
        <span>Any detail that helps</span>
        <textarea
          name="description"
          required
          rows={3}
          className="rounded-md border px-3 py-2"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span>Category</span>
          <select name="category" className="rounded-md border px-3 py-2">
            <option value="">Choose one</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span>Neighbourhood or town</span>
          <input
            name="locality"
            maxLength={120}
            className="rounded-md border px-3 py-2"
            placeholder="Southwest Detroit"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span>How many (optional)</span>
          <input
            name="quantity"
            type="number"
            min={1}
            step={1}
            className="rounded-md border px-3 py-2"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span>Of what (optional)</span>
          <input
            name="unit_of_measure"
            maxLength={40}
            className="rounded-md border px-3 py-2"
            placeholder="rides, boxes, hours"
          />
        </label>

        {mode === "request" ? (
          <label className="grid gap-1 text-sm sm:col-span-2">
            <span>How soon</span>
            <select name="urgency" className="rounded-md border px-3 py-2">
              <option value="ROUTINE">Whenever someone can</option>
              <option value="SOON">Soon</option>
              <option value="URGENT">Urgently</option>
            </select>
            <span className="text-xs text-ui-fg-subtle">
              Only you see this. The public board does not rank posts by
              urgency.
            </span>
          </label>
        ) : null}
      </div>

      <p className="text-xs text-ui-fg-subtle">
        A neighbourhood is as precise as this board gets. Never post an address
        here — arrange that directly with whoever takes it on.
      </p>

      {state === "error" ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={state === "saving"}
          className="rounded-md bg-primary px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {state === "saving" ? "Posting…" : "Post it"}
        </button>
      </div>
    </form>
  )
}
