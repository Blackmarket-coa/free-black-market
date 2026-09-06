import { useQuery } from "@tanstack/react-query"
import { fetchQuery } from "../../lib/client"

export const donationQueryKeys = {
  settings: ["donations", "settings"] as const,
  report: ["donations", "report"] as const,
  beneficiaries: ["donations", "beneficiaries"] as const,
}

// Read-only: donation checkout settings are platform-wide and written only
// through the admin route; the vendor route answers POST with 403.
export const useDonationSettings = () => {
  return useQuery({
    queryKey: donationQueryKeys.settings,
    queryFn: () => fetchQuery("/vendor/donations/settings", { method: "GET" }),
  })
}

export const useDonationReport = () => {
  return useQuery({
    queryKey: donationQueryKeys.report,
    queryFn: () => fetchQuery("/vendor/donations/report", { method: "GET" }),
  })
}

export const useDonationBeneficiaries = () => {
  return useQuery({
    queryKey: donationQueryKeys.beneficiaries,
    queryFn: () => fetchQuery("/vendor/donations/beneficiaries", { method: "GET" }),
  })
}
