import type { Metadata } from "next"
import { AccountLoadingState, LoginForm } from "@/components/molecules"
import { retrieveCustomerContext } from "@/lib/data/customer"
import { getXpRewards } from "@/lib/data/progression"
import { XpRewardsList } from "@/components/sections/XpRewards/XpRewardsList"

export const metadata: Metadata = {
  title: "XP Rewards",
  description:
    "Spend your earned XP on perks and downloads. Your level and titles stay yours.",
}

export default async function RewardsPage() {
  const { customer, isAuthenticated } = await retrieveCustomerContext()

  if (!customer) {
    if (!isAuthenticated) return <LoginForm />
    return <AccountLoadingState title="XP Rewards" />
  }

  const data = await getXpRewards()

  return (
    <main className="container">
      <div className="mt-6 space-y-6">
        <header>
          <h1 className="heading-lg">XP Rewards</h1>
          <p className="text-secondary mt-1">
            Trade spendable XP for perks and downloads.
          </p>
        </header>
        <XpRewardsList
          balance={data?.balance ?? 0}
          rewards={data?.rewards ?? []}
          history={data?.history ?? []}
        />
      </div>
    </main>
  )
}
