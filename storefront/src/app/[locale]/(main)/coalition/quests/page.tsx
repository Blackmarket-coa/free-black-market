import type { Metadata } from "next"

import {
  getCollectiveGoals,
  getCollectiveQuests,
  getDenLeaderboard,
} from "@/lib/data/collective-quest"
import { Thermometer } from "@/components/sections/CollectiveQuests/Thermometer"
import { QuestBoss } from "@/components/sections/CollectiveQuests/QuestBoss"
import { DenLeaderboard } from "@/components/sections/CollectiveQuests/DenLeaderboard"
import { QuestProgressWatcher } from "@/components/sections/CollectiveQuests/QuestProgressWatcher"

export const metadata: Metadata = {
  title: "Coalition Quests",
  description:
    "Shared goals and group quests — grow the cooperative economy together. Progress is collective, not a competition.",
}

export default async function CoalitionQuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ den?: string }>
}) {
  const { den } = await searchParams

  const [goals, quests, completedQuests, leaderboard] = await Promise.all([
    getCollectiveGoals(den),
    getCollectiveQuests(den, "ACTIVE"),
    getCollectiveQuests(den, "COMPLETE"),
    den ? getDenLeaderboard(den) : Promise.resolve([]),
  ])

  return (
    <main className="container">
      <QuestProgressWatcher completedCount={completedQuests.length} />
      <div className="mt-6 space-y-8">
        <header className="rounded-lg border border-tertiary bg-component p-6">
          <p className="text-secondary text-sm uppercase tracking-wide">Coalition</p>
          <h1 className="heading-lg">Shared Goals & Group Quests</h1>
          <p className="text-secondary mt-1">
            Grow the cooperative economy together. Every thermometer fills from
            real activity, and group quests reward everyone who shows up — the
            goal is the shared harvest, never a ranking.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="heading-sm uppercase">Community Thermometers</h2>
          {goals.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {goals.map((g) => (
                <Thermometer key={g.id} goal={g} />
              ))}
            </div>
          ) : (
            <p className="text-secondary text-sm">No shared goals are active right now.</p>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="heading-sm uppercase">Group Quests</h2>
          {quests.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {quests.map((q) => (
                <QuestBoss key={q.id} quest={q} />
              ))}
            </div>
          ) : (
            <p className="text-secondary text-sm">No group quests are active right now.</p>
          )}
        </section>

        {den && (
          <section className="rounded-lg border border-tertiary p-6 space-y-4">
            <h2 className="heading-sm uppercase">Den Activity (opt-in)</h2>
            <DenLeaderboard entries={leaderboard} />
          </section>
        )}
      </div>
    </main>
  )
}
