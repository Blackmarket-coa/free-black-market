import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchQuery } from "../../lib/client"

export const donationQueryKeys = {
  settings: ["donations", "settings"] as const,
  report: ["donations", "report"] as const,
  beneficiaries: ["donations", "beneficiaries"] as const,
}

export const useDonationSettings = () => {
  return useQuery({
    queryKey: donationQueryKeys.settings,
    queryFn: () => fetchQuery("/vendor/donations/settings", { method: "GET" }),
  })
}

export const useUpdateDonationSettings = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      fetchQuery("/vendor/donations/settings", { method: "POST", body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: donationQueryKeys.settings })
    },
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
