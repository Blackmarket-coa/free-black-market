"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { useBlackoutEffects } from "@/components/providers"
import {
  redeemXpReward,
  type XpRedemption,
  type XpReward,
} from "@/lib/data/progression"

type Feedback = { kind: "success" | "error"; message: string } | null

/**
 * Spendable-XP storefront: shows the balance and lets a member redeem catalog
 * rewards. A successful redemption plays a calm milestone celebration and
 * refreshes the server data so the balance / history stay truthful.
 */
export function XpRewardsList({
  balance,
  rewards,
  history,
  treesPlanted = 0,
}: {
  balance: number
  rewards: XpReward[]
  history: XpRedemption[]
  treesPlanted?: number
}) {
  const router = useRouter()
  const { celebrate } = useBlackoutEffects()
  const [pending, startTransition] = useTransition()
  const [redeemingKey, setRedeemingKey] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const handleRedeem = (reward: XpReward) => {
    setRedeemingKey(reward.key)
    setFeedback(null)
    startTransition(async () => {
      const result = await redeemXpReward(reward.key)
      if (result.ok) {
        celebrate("milestone")
        setFeedback({
          kind: "success",
          message:
            reward.impact === "tree"
              ? `Thank you! You funded ${reward.impactUnits ?? 1} ${
                  (reward.impactUnits ?? 1) === 1 ? "tree" : "trees"
                }. 🌳`
              : `Redeemed “${reward.name}”. Enjoy!`,
        })
        router.refresh()
      } else {
        setFeedback({
          kind: "error",
          message:
            result.required != null && result.available != null
              ? `Not enough XP — needs ${result.required}, you have ${result.available}.`
              : result.error,
        })
      }
      setRedeemingKey(null)
    })
  }

  return (
    <div className="space-y-8">
      <header className="rounded-lg border border-tertiary bg-amber-50 p-6">
        <p className="text-secondary text-sm uppercase tracking-wide">
          Spendable Balance
        </p>
        <p className="heading-lg">{balance.toLocaleString()} XP</p>
        <p className="text-secondary mt-1 text-sm">
          Spend earned XP on perks, downloads, and real-world impact. Spending
          never lowers your level or titles — those are yours for good.
        </p>
      </header>

      <div className="rounded-lg border border-green-300 bg-green-50 p-4 flex items-center gap-3">
        <span aria-hidden className="text-2xl">
          🌳
        </span>
        <p className="text-green-800 text-sm">
          The community has planted{" "}
          <strong>{treesPlanted.toLocaleString()}</strong>{" "}
          {treesPlanted === 1 ? "tree" : "trees"} with XP. Redeem below to grow
          the canopy.
        </p>
      </div>

      {feedback && (
        <div
          role="status"
          className={`rounded-md border p-3 text-sm ${
            feedback.kind === "success"
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {rewards.map((reward) => {
          const isThisRedeeming = pending && redeemingKey === reward.key
          const disabled = pending || !reward.affordable
          return (
            <div
              key={reward.key}
              className="card-organic flex flex-col justify-between p-5"
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="heading-sm">{reward.name}</h3>
                  <span className="badge-accent shrink-0">
                    {reward.impact === "tree"
                      ? `🌳 ${reward.impactUnits ?? 1} ${
                          (reward.impactUnits ?? 1) === 1 ? "tree" : "trees"
                        }`
                      : reward.kind === "digital_download"
                        ? "Download"
                        : "Perk"}
                  </span>
                </div>
                <p className="text-secondary text-sm mt-2">
                  {reward.description}
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="label-lg">
                  {reward.xpCost.toLocaleString()} XP
                </span>
                <button
                  type="button"
                  onClick={() => handleRedeem(reward)}
                  disabled={disabled}
                  className="button-filled px-4 py-2 label-md disabled:opacity-50"
                >
                  {isThisRedeeming
                    ? "Redeeming…"
                    : reward.affordable
                      ? "Redeem"
                      : "Not enough XP"}
                </button>
              </div>
            </div>
          )
        })}
      </section>

      {history.length > 0 && (
        <section className="rounded-lg border border-tertiary p-6">
          <h2 className="heading-sm uppercase mb-4">Redemption History</h2>
          <ul className="divide-y divide-[rgba(var(--neutral-200),0.6)]">
            {history.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="text-primary">{r.reward_name}</span>
                <span className="text-secondary">
                  −{r.xp_cost.toLocaleString()} XP · {r.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
