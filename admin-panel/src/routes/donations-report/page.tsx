import { useQuery } from "@tanstack/react-query"
import { Container, Heading, Text } from "@medusajs/ui"
import { sdk } from "@lib/client"

export const DonationReportPage = () => {
  const { data } = useQuery({
    queryKey: ["donations-report"],
    queryFn: () => sdk.client.fetch<{ report: any }>("/admin/donations/report"),
  })

  return (
    <Container>
      <Heading>Donation Transparency Report</Heading>
      <Text size="small" className="text-ui-fg-subtle">Internal transparency summary for accrued, disbursed, and outstanding donation balances.</Text>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="border rounded p-3">Accrued: {data?.report?.totals?.accrued ?? 0}</div>
        <div className="border rounded p-3">Disbursed: {data?.report?.totals?.disbursed ?? 0}</div>
        <div className="border rounded p-3">Outstanding: {data?.report?.totals?.outstanding ?? 0}</div>
      </div>

      <div className="mt-6 space-y-2">
        {data?.report?.beneficiaries?.map((row: any) => (
          <div key={row.beneficiary_id} className="border rounded p-3 flex justify-between">
            <div>{row.beneficiary_name}</div>
            <div>Accrued: {row.total_accrued} / Disbursed: {row.total_disbursed} / Outstanding: {row.outstanding}</div>
          </div>
        ))}
      </div>
    </Container>
  )
}

export const Component = DonationReportPage
