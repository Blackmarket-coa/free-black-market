import { useCallback, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button, Checkbox, Container, Heading, Text } from "@medusajs/ui"
import { sdk } from "@lib/client"
import { StorefrontSwitcher } from "@components/tenancy/storefront-switcher"
import type { StorefrontContext } from "@lib/tenancy/context"

export const OnboardingChecklistPage = () => {
  const [ctx, setCtx] = useState<StorefrontContext | null>(null)

  const { data: orgs } = useQuery({
    queryKey: ["tenancy-organizations"],
    queryFn: () => sdk.client.fetch<{ organizations: any[] }>("/admin/tenancy/organizations"),
  })

  const { data: storefronts } = useQuery({
    queryKey: ["tenancy-storefronts"],
    queryFn: () => sdk.client.fetch<{ storefronts: any[] }>("/admin/tenancy/storefronts"),
  })

  const { data, refetch } = useQuery({
    queryKey: ["first-listing-checklist", ctx?.organizationId, ctx?.storefrontId],
    queryFn: () =>
      sdk.client.fetch<{ state: any }>(
        `/admin/tenancy/onboarding/first-listing?organization_id=${ctx?.organizationId}&storefront_id=${ctx?.storefrontId}`
      ),
    enabled: Boolean(ctx?.organizationId && ctx?.storefrontId),
  })

  const update = async (patch: Record<string, boolean>) => {
    if (!ctx) return
    await sdk.client.fetch("/admin/tenancy/onboarding/first-listing", {
      method: "POST",
      body: {
        organization_id: ctx.organizationId,
        storefront_id: ctx.storefrontId,
        ...patch,
      },
    })
    refetch()
  }

  const onContextChange = useCallback((next: StorefrontContext) => setCtx(next), [])

  return (
    <Container>
      <Heading>First listing onboarding checklist</Heading>
      <Text size="small" className="text-ui-fg-subtle">Track key setup milestones for the selected storefront.</Text>

      <div className="mt-4 mb-4">
        <StorefrontSwitcher
          organizations={orgs?.organizations || []}
          storefronts={storefronts?.storefronts || []}
          onContextChange={onContextChange}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between border rounded p-3">
          <div className="flex items-center gap-2"><Checkbox checked={Boolean(data?.state?.first_listing_created)} /></div>
          <Button variant="secondary" onClick={() => update({ first_listing_created: !data?.state?.first_listing_created })}>Toggle first listing created</Button>
        </div>
        <div className="flex items-center justify-between border rounded p-3">
          <div className="flex items-center gap-2"><Checkbox checked={Boolean(data?.state?.payout_configured)} /></div>
          <Button variant="secondary" onClick={() => update({ payout_configured: !data?.state?.payout_configured })}>Toggle payout configured</Button>
        </div>
        <div className="flex items-center justify-between border rounded p-3">
          <div className="flex items-center gap-2"><Checkbox checked={Boolean(data?.state?.first_order_simulated)} /></div>
          <Button variant="secondary" onClick={() => update({ first_order_simulated: !data?.state?.first_order_simulated })}>Toggle first order simulated</Button>
        </div>
      </div>
    </Container>
  )
}

export const Component = OnboardingChecklistPage
