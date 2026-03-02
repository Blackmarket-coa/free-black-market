import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { getDonationSettings, listDonationBeneficiaries } from "@/lib/data/donations"

export default async function DonationsPage() {
  const settings = await getDonationSettings().catch(() => null)
  const beneficiaries = await listDonationBeneficiaries().catch(() => [])

  return (
    <div className="content-container py-12 space-y-6">
      <h1 className="text-3xl font-semibold">Community Donations</h1>
      <p className="text-ui-fg-subtle max-w-2xl">
        Support verified community beneficiaries during checkout. Choose a donation percentage,
        optional round-up, and beneficiary from your cart review step.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border p-4">
          <h2 className="font-medium mb-2">Checkout donation settings</h2>
          <p className="text-sm text-ui-fg-subtle">Default donation: {settings?.settings?.default_percentage ?? 0}%</p>
          <p className="text-sm text-ui-fg-subtle">Round-up enabled: {settings?.settings?.round_up_enabled ? "Yes" : "No"}</p>
        </div>
        <div className="rounded border p-4">
          <h2 className="font-medium mb-2">Available beneficiaries</h2>
          {beneficiaries.length ? (
            <ul className="list-disc pl-5 text-sm space-y-1">
              {beneficiaries.map((beneficiary) => (
                <li key={beneficiary.id}>{beneficiary.name}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ui-fg-subtle">No beneficiaries are currently available for this storefront tier.</p>
          )}
        </div>
      </div>

      <div>
        <LocalizedClientLink href="/checkout?step=payment" className="underline">
          Go to checkout donation step
        </LocalizedClientLink>
      </div>
    </div>
  )
}
