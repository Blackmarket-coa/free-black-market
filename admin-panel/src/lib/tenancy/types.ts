/**
 * Shapes returned by the admin tenancy endpoints
 * (`/admin/tenancy/organizations`, `/admin/tenancy/storefronts`). Centralized
 * so the tenancy pages and the StorefrontSwitcher share one definition instead
 * of typing the fetch responses as `any[]`.
 */
export type TenancyOrganization = {
  id: string
  name: string
}

export type TenancyStorefront = {
  id: string
  name: string
  organization_id: string
  tier: string
  metadata?: Record<string, unknown> | null
}
