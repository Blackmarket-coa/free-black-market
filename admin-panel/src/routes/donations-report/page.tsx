import { useCallback, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Container, Heading, Text } from "@medusajs/ui"
import { sdk } from "@lib/client"
import { StorefrontSwitcher } from "@components/tenancy/storefront-switcher"
import type { StorefrontContext} from "@lib/tenancy/context";
import { withStorefrontHeaders } from "@lib/tenancy/context"
import type { TenancyOrganization, TenancyStorefront } from "@lib/tenancy/types"

export const DonationReportPage = () => {
  const [ctx, setCtx] = useState<StorefrontContext | null>(null)
  const headers = withStorefrontHeaders(ctx)

  const { data: orgs } = useQuery({
    queryKey: ["tenancy-organizations"],
    queryFn: () => sdk.client.fetch<{ organizations: TenancyOrganization[] }>("/admin/tenancy/organizations"),
  })

  const { data: storefronts } = useQuery({
    queryKey: ["tenancy-storefronts"],
    queryFn: () => sdk.client.fetch<{ storefronts: TenancyStorefront[] }>("/admin/tenancy/storefronts"),
  })

  const { data } = useQuery({
    queryKey: ["donations-report", ctx?.organizationId, ctx?.storefrontId],
    queryFn: () => sdk.client.fetch<{ report: any }>("/admin/donations/report", { headers }),
    enabled: Boolean(ctx),
  })

  const onContextChange = useCallback((next: StorefrontContext) => setCtx(next), [])

  return (
    <Container>
      <Heading>Donation Transparency Report</Heading>
      <Text size="small" className="text-ui-fg-subtle">Internal transparency summary scoped to selected storefront context.</Text>

      <div className="mt-4 mb-4">
        <StorefrontSwitcher
          organizations={orgs?.organizations || []}
          storefronts={storefronts?.storefronts || []}
          onContextChange={onContextChange}
        />
      </div>

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
