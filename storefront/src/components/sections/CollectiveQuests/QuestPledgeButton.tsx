"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { useBlackoutEffects } from "@/components/providers"
import { toast } from "@/lib/helpers/toast"
import { contributeToQuest } from "@/lib/data/collective-quest"

/**
 * Member pledge control for a group quest. Pledges are recorded *unverified*
 * (boss HP only drops after a trusted backend verifies), so the copy frames it
 * as "pledge effort", not "deal damage". Opt-in to the den activity view is an
 * explicit, off-by-default checkbox (ADR-0004).
 */
export function QuestPledgeButton({ questId }: { questId: string }) {
  const [optIn, setOptIn] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const { celebrate } = useBlackoutEffects()

  const pledge = () => {
    startTransition(async () => {
      const { ok } = await contributeToQuest(questId, 1, optIn)
      if (ok) {
        celebrate("confirm")
        toast.success({ title: "Pledge recorded", description: "Thanks for showing up for the den." })
        router.refresh()
      } else {
        toast.error({ title: "Could not record pledge", description: "Please try again." })
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={pledge}
        disabled={pending}
        className="button-filled self-start px-4 py-2 text-sm disabled:opacity-60"
      >
        {pending ? "Pledging…" : "Pledge effort"}
      </button>
      <label className="text-secondary flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={optIn}
          onChange={(e) => setOptIn(e.target.checked)}
        />
        Show me in the den activity view
      </label>
    </div>
  )
}
