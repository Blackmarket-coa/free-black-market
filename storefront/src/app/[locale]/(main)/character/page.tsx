import type { Metadata } from "next"
import { AccountLoadingState, LoginForm } from "@/components/molecules"
import { retrieveCustomerContext } from "@/lib/data/customer"
import { getCharacterSheet } from "@/lib/data/progression"
import { RoleTrackBar } from "@/components/organisms/CharacterSheet/RoleTrackBar"
import { TitleBadge } from "@/components/organisms/CharacterSheet/TitleBadge"
import { ProgressWatcher } from "@/components/organisms/CharacterSheet/ProgressWatcher"

export const metadata: Metadata = {
  title: "Character",
  description:
    "Your character sheet — role levels, lifetime stats, and earned titles across the Free Black Market economy.",
}

const STANCE_LABEL: Record<string, string> = {
  producer: "Producer",
  consumer: "Consumer",
  investor: "Investor",
  coalition: "Coalition Member",
  creator: "Creator",
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default async function CharacterPage() {
  const { customer, isAuthenticated } = await retrieveCustomerContext()

  if (!customer) {
    if (!isAuthenticated) return <LoginForm />
    return <AccountLoadingState title="Character" />
  }

  const character = await getCharacterSheet()

  const displayName =
    [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
    customer.email ||
    "Adventurer"

  const overallLevel = character
    ? character.tracks.reduce((max, t) => Math.max(max, t.level), 0)
    : 0

  const stats = character?.stats

  return (
    <main className="container">
      <ProgressWatcher
        overallLevel={overallLevel}
        titleCount={character?.titles.length ?? 0}
      />
      <div className="mt-6 space-y-8">
        <header className="rounded-lg border border-tertiary bg-green-50 p-6">
          <p className="text-secondary text-sm uppercase tracking-wide">
            Character Sheet
          </p>
          <h1 className="heading-lg">{displayName}</h1>
          <p className="text-secondary mt-1">
            Overall Level {overallLevel} ·{" "}
            {STANCE_LABEL[character?.activeStance ?? "consumer"]} stance ·{" "}
            {character?.totalXp ?? 0} total XP
          </p>
        </header>

        {/* Role tracks */}
        <section className="rounded-lg border border-tertiary p-6 space-y-5">
          <h2 className="heading-sm uppercase">Role Tracks</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {(character?.tracks ?? []).map((track) => (
              <RoleTrackBar key={track.role} track={track} />
            ))}
          </div>
        </section>

        {/* Lifetime stats */}
        <section className="rounded-lg border border-tertiary p-6 space-y-4">
          <h2 className="heading-sm uppercase">Lifetime Stats</h2>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="🛒 Orders Completed" value={stats?.ordersCompleted ?? 0} />
            <Stat label="🌾 Food Produced" value={dollars(stats?.foodProducedCents ?? 0)} />
            <Stat label="💰 Capital Deployed" value={dollars(stats?.capitalDeployedCents ?? 0)} />
            <Stat label="🤝 Mutual Aid" value={stats?.mutualAidContributions ?? 0} />
            <Stat label="⭐ Trust Score" value={`${stats?.trustScore ?? 0}/100`} />
            <Stat label="✨ Karma" value={stats?.karma ?? 0} />
            <Stat label="⏱ Time Credits" value={stats?.timeCredits ?? 0} />
          </dl>
        </section>

        {/* Titles */}
        <section className="rounded-lg border border-tertiary p-6 space-y-4">
          <h2 className="heading-sm uppercase">Titles</h2>
          {character && character.titles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {character.titles.map((title) => (
                <TitleBadge key={title.slug} title={title} />
              ))}
            </div>
          ) : (
            <p className="text-secondary text-sm">
              No titles earned yet. Level up a role track to earn your first
              title.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-secondary text-xs">{label}</dt>
      <dd className="heading-md">{value}</dd>
    </div>
  )
}
