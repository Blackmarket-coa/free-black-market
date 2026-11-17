import type { Metadata } from "next"
import { AccountLoadingState, LoginForm, UserNavigation } from "@/components/molecules"
import { retrieveCustomerContext } from "@/lib/data/customer"


export const metadata: Metadata = {
  title: "Your Account",
  description: "Manage your account dashboard and profile details.",
}

export default async function UserPage() {
  const { customer, isAuthenticated } = await retrieveCustomerContext()

  if (!customer) {
    if (!isAuthenticated) return <LoginForm />
    return <AccountLoadingState title="Account" />
  }

  return (
    <main className="container">
      <div className="grid grid-cols-1 md:grid-cols-4 mt-6 gap-5 md:gap-8">
        <UserNavigation />
        <div className="md:col-span-3">
          <h1 className="heading-xl uppercase">
            {customer.first_name ? `Welcome ${customer.first_name}` : "Welcome"}
          </h1>
          <p className="label-md">Your account is ready to go!</p>
        </div>
      </div>
    </main>
  )
}
