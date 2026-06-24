import type { CollectiveQuest } from "@/lib/data/collective-quest"
import { QuestPledgeButton } from "./QuestPledgeButton"

/**
 * A Habitica-style group "boss" quest. The HP bar is collective progress
 * (verified contributions only); completion shares the reward pool across
 * contributors. Pure presentational + the client pledge control.
 */
export function QuestBoss({ quest }: { quest: CollectiveQuest }) {
  const pct =
    quest.boss_hp > 0
      ? Math.max(0, Math.min(100, Math.round((quest.hp_remaining / quest.boss_hp) * 100)))
      : 0
  const done = quest.status === "COMPLETE" || quest.hp_remaining <= 0

  return (
    <div className="rounded-lg border border-tertiary p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="heading-sm">🛡️ {quest.title}</h3>
        <span className="badge-accent text-xs">+{quest.reward_pool_xp.toLocaleString()} shared XP</span>
      </div>
      {quest.description && (
        <p className="text-secondary text-sm">{quest.description}</p>
      )}
      <div
        className="h-4 w-full overflow-hidden rounded-full bg-component"
        role="progressbar"
        aria-valuenow={100 - pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${quest.title} collective progress`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 transition-[width] duration-700 ease-out"
          style={{ width: `${100 - pct}%` }}
        />
      </div>
      <p className="text-secondary text-xs">
        {done
          ? "Quest complete — shared XP distributed to everyone who showed up. 🎉"
          : `${quest.hp_remaining.toLocaleString()} / ${quest.boss_hp.toLocaleString()} remaining`}
      </p>
      {!done && <QuestPledgeButton questId={quest.id} />}
    </div>
  )
}
