import type { Metadata } from "next"
import { AccountLoadingState, LoginForm, PrivacyDataSettings, ProfileDetails, UserNavigation } from "@/components/molecules"
import { ProfilePassword } from "@/components/molecules/ProfileDetails/ProfilePassword"
import { BlackoutEffectsSettings } from "@/components/molecules/BlackoutEffectsSettings/BlackoutEffectsSettings"
import { retrieveCustomerContext } from "@/lib/data/customer"


export const metadata: Metadata = {
  title: "Account Settings",
  description: "Update your profile, password, and account preferences.",
}

export default async function ReviewsPage() {
  const { customer, isAuthenticated } = await retrieveCustomerContext()

  if (!customer) {
    if (!isAuthenticated) return <LoginForm />
    return <AccountLoadingState title="Settings" />
  }

  return (
    <main className="container">
      <div className="grid grid-cols-1 md:grid-cols-4 mt-6 gap-5 md:gap-8">
        <UserNavigation />
        <div className="md:col-span-3">
          <h1 className="heading-md uppercase mb-8">Settings</h1>
          <ProfileDetails user={customer} />
          <ProfilePassword user={customer} />
          <BlackoutEffectsSettings />
          <PrivacyDataSettings />
        </div>
      </div>
    </main>
  )
}
