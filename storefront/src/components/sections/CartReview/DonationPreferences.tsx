"use client"

import { useMemo, useState, useTransition } from "react"
import { setCartDonationPreferences, type DonationBeneficiary } from "@/lib/data/donations"
import { Button } from "@/components/atoms"

type Props = {
  cartTotal: number
  beneficiaries: DonationBeneficiary[]
  defaultPercent: number
  roundUpEnabled: boolean
  /** 501(c)(3) fiscal sponsor name surfaced under Posture A compliance. */
  fiscalSponsorName?: string | null
  fiscalSponsorUrl?: string | null
  /**
   * Only true once the sponsorship agreement is live
   * (`docs/FISCAL_SPONSOR_DECISION.md`). Anything else renders the "pending"
   * copy: the widget must never tell a donor their gift is routed through a
   * 501(c)(3) before it is.
   */
  fiscalSponsorLive?: boolean
  initialMetadata?: Record<string, any>
}

export default function DonationPreferences({
  cartTotal,
  beneficiaries,
  defaultPercent,
  roundUpEnabled,
  fiscalSponsorName,
  fiscalSponsorUrl,
  fiscalSponsorLive = false,
  initialMetadata,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [percent, setPercent] = useState(Number(initialMetadata?.donation_percent || defaultPercent || 0))
  const [roundUp, setRoundUp] = useState(Boolean(initialMetadata?.donation_round_up || false))
  const [beneficiary, setBeneficiary] = useState(String(initialMetadata?.donation_beneficiary_id || beneficiaries[0]?.id || ""))

  const donationEstimate = useMemo(() => {
    const percentValue = (cartTotal * percent) / 100
    const roundUpValue = roundUp && roundUpEnabled ? Math.ceil(cartTotal / 100) * 100 - cartTotal : 0
    return Math.max(0, Math.round(percentValue + roundUpValue))
  }, [cartTotal, percent, roundUp, roundUpEnabled])

  return (
    <div className="w-full mb-6 border rounded-sm p-4 bg-white">
      <h3 className="font-semibold mb-3">Community Donation</h3>
      <p className="text-sm text-gray-600 mb-2">Choose donation percentage, optional round-up, and a beneficiary organization.</p>
      {fiscalSponsorName && fiscalSponsorLive ? (
        <p className="text-xs text-gray-500 mb-4">
          Routed through{" "}
          {fiscalSponsorUrl ? (
            <a
              href={fiscalSponsorUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {fiscalSponsorName}
            </a>
          ) : (
            <span className="font-medium">{fiscalSponsorName}</span>
          )}
          , our 501(c)(3) fiscal sponsor. They issue donor receipts and handle
          state charity registrations.
        </p>
      ) : (
        <p className="text-xs text-gray-500 mb-4" data-testid="donation-sponsor-pending">
          Fiscal sponsor pending — routing held.
          {fiscalSponsorName ? (
            <>
              {" "}Our sponsorship agreement with{" "}
              <span className="font-medium">{fiscalSponsorName}</span> is not yet in
              effect.
            </>
          ) : null}{" "}
          Donations are recorded and held until it is; no 501(c)(3) donor receipt
          is issued yet.
        </p>
      )}

      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block">Donation percentage</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value || 0))}
            className="w-full border rounded px-3 py-2"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={roundUp}
            onChange={(e) => setRoundUp(e.target.checked)}
            disabled={!roundUpEnabled}
          />
          Enable round-up donation
        </label>

        <label className="block text-sm">
          <span className="mb-1 block">Beneficiary</span>
          <select
            value={beneficiary}
            onChange={(e) => setBeneficiary(e.target.value)}
            className="w-full border rounded px-3 py-2"
          >
            {beneficiaries.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <div className="text-sm text-gray-700">Estimated donation: {(donationEstimate / 100).toFixed(2)}</div>

        <Button
          size="small"
          onClick={() =>
            startTransition(async () => {
              await setCartDonationPreferences({
                donation_percent: percent,
                round_up: roundUp,
                beneficiary_id: beneficiary,
                donation_total: donationEstimate,
              })
            })
          }
          loading={isPending}
        >
          Save donation preferences
        </Button>
      </div>
    </div>
  )
}
