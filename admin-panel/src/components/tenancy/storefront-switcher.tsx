import { useEffect, useState } from "react"
import { Select, Text } from "@medusajs/ui"
import type { StorefrontContext } from "@lib/tenancy/context";
import { getStoredContext, setStoredContext } from "@lib/tenancy/context"
import type { TenancyOrganization, TenancyStorefront } from "@lib/tenancy/types"

export const StorefrontSwitcher = ({
  organizations,
  storefronts,
  onContextChange,
}: {
  organizations: TenancyOrganization[]
  storefronts: TenancyStorefront[]
  onContextChange: (ctx: StorefrontContext) => void
}) => {
  const [organizationId, setOrganizationId] = useState("")
  const [storefrontId, setStorefrontId] = useState("")

  useEffect(() => {
    const cached = getStoredContext()
    if (cached) {
      setOrganizationId(cached.organizationId)
      setStorefrontId(cached.storefrontId)
      onContextChange(cached)
      
return
    }

    if (organizations[0]) {
      const orgId = organizations[0].id
      const sf = storefronts.find((s) => s.organization_id === orgId)
      if (sf) {
        const next = { organizationId: orgId, storefrontId: sf.id }
        setOrganizationId(orgId)
        setStorefrontId(sf.id)
        setStoredContext(next)
        onContextChange(next)
      }
    }
  }, [organizations, storefronts, onContextChange])

  const filtered = storefronts.filter((s) => s.organization_id === organizationId)

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Text size="small" className="text-ui-fg-subtle">Organization</Text>
        <Select value={organizationId} onValueChange={(value) => {
          setOrganizationId(value)
          const sf = storefronts.find((s) => s.organization_id === value)
          if (sf) {
            const next = { organizationId: value, storefrontId: sf.id }
            setStorefrontId(sf.id)
            setStoredContext(next)
            onContextChange(next)
          }
        }}>
          <Select.Trigger><Select.Value placeholder="Select org" /></Select.Trigger>
          <Select.Content>
            {organizations.map((o) => <Select.Item key={o.id} value={o.id}>{o.name}</Select.Item>)}
          </Select.Content>
        </Select>
      </div>
      <div>
        <Text size="small" className="text-ui-fg-subtle">Storefront</Text>
        <Select value={storefrontId} onValueChange={(value) => {
          setStorefrontId(value)
          const next = { organizationId, storefrontId: value }
          setStoredContext(next)
          onContextChange(next)
        }}>
          <Select.Trigger><Select.Value placeholder="Select storefront" /></Select.Trigger>
          <Select.Content>
            {filtered.map((s) => <Select.Item key={s.id} value={s.id}>{s.name} ({s.tier})</Select.Item>)}
          </Select.Content>
        </Select>
      </div>
    </div>
  )
}
