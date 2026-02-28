import { useCallback, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button, Container, Heading, Input, Label, Select, Text, Textarea } from "@medusajs/ui"
import { sdk } from "@lib/client"
import { StorefrontSwitcher } from "@components/tenancy/storefront-switcher"
import { StorefrontContext, withStorefrontHeaders } from "@lib/tenancy/context"

const SHOPIFY_EXAMPLE = `Handle,Title,Body (HTML),Variant SKU,Variant Price\norganic-kale,Organic Kale,<p>Fresh kale</p>,KALE-001,3.99`

export const DonationsPage = () => {
  const [ctx, setCtx] = useState<StorefrontContext | null>(null)
  const [csv, setCsv] = useState(SHOPIFY_EXAMPLE)
  const [preset, setPreset] = useState<"shopify" | "custom">("shopify")
  const [importResult, setImportResult] = useState<any>(null)
  const [templateKey, setTemplateKey] = useState("food_coop")
  const [newStorefrontName, setNewStorefrontName] = useState("")
  const [newStorefrontSlug, setNewStorefrontSlug] = useState("")

  const headers = withStorefrontHeaders(ctx)

  const { data: orgs } = useQuery({
    queryKey: ["tenancy-organizations"],
    queryFn: () => sdk.client.fetch<{ organizations: any[] }>("/admin/tenancy/organizations"),
  })

  const { data: storefronts, refetch: refetchStorefronts } = useQuery({
    queryKey: ["tenancy-storefronts"],
    queryFn: () => sdk.client.fetch<{ storefronts: any[] }>("/admin/tenancy/storefronts"),
  })

  const currentStorefront = useMemo(
    () => storefronts?.storefronts?.find((s) => s.id === ctx?.storefrontId),
    [storefronts, ctx]
  )

  const { data, refetch } = useQuery({
    queryKey: ["donations-beneficiaries", ctx?.organizationId, ctx?.storefrontId],
    queryFn: () => sdk.client.fetch<{ beneficiaries: any[] }>("/admin/donations/beneficiaries", { headers }),
    enabled: Boolean(ctx),
  })

  const { data: settings, refetch: refetchSettings } = useQuery({
    queryKey: ["donations-settings", ctx?.organizationId, ctx?.storefrontId],
    queryFn: () => sdk.client.fetch<{ settings: any }>("/admin/donations/settings", { headers }),
    enabled: Boolean(ctx),
  })

  const { data: templates } = useQuery({
    queryKey: ["tenancy-storefront-templates"],
    queryFn: () => sdk.client.fetch<{ templates: any[] }>("/admin/tenancy/storefronts/templates"),
  })

  const updateStatus = async (id: string, verification_status: string) => {
    const target = data?.beneficiaries?.find((b) => b.id === id)
    if (!target) return
    await sdk.client.fetch("/admin/donations/beneficiaries", {
      method: "PATCH",
      body: { ...target, verification_status },
      headers,
    })
    refetch()
  }

  const updateMode = async (mode: "split_processor" | "ledger_batch") => {
    await sdk.client.fetch("/admin/donations/settings", {
      method: "POST",
      body: { settlement_mode: mode },
      headers,
    })
    refetchSettings()
  }

  const setSandboxMode = async (enabled: boolean) => {
    if (!ctx?.storefrontId) return
    await sdk.client.fetch("/admin/tenancy/sandbox", {
      method: "POST",
      body: { storefront_id: ctx.storefrontId, enabled },
    })
    refetchStorefronts()
  }

  const runImporter = async () => {
    const result = await sdk.client.fetch("/admin/tenancy/storefronts/import", {
      method: "POST",
      body: { csv, preset },
    })
    setImportResult(result)
  }

  const createFromTemplate = async () => {
    if (!ctx?.organizationId || !newStorefrontName || !newStorefrontSlug) return
    await sdk.client.fetch("/admin/tenancy/storefronts/from-template", {
      method: "POST",
      body: {
        organization_id: ctx.organizationId,
        storefront_name: newStorefrontName,
        storefront_slug: newStorefrontSlug,
        template_key: templateKey,
      },
    })
    setNewStorefrontName("")
    setNewStorefrontSlug("")
    refetchStorefronts()
  }

  const onContextChange = useCallback((next: StorefrontContext) => setCtx(next), [])

  return (
    <div className="flex flex-col gap-4">
      <Container>
        <Heading>Storefront context</Heading>
        <Text size="small" className="text-ui-fg-subtle">Hard context boundary: all donation actions are constrained to selected organization/storefront.</Text>
        <div className="mt-3">
          <StorefrontSwitcher
            organizations={orgs?.organizations || []}
            storefronts={storefronts?.storefronts || []}
            onContextChange={onContextChange}
          />
        </div>
      </Container>

      <Container>
        <Heading>Starter storefront templates</Heading>
        <Text size="small" className="text-ui-fg-subtle">Three vertical presets: food coop, restaurant collective, nonprofit marketplace.</Text>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {(templates?.templates || []).map((t) => (
            <div key={t.key} className="border rounded p-2 text-sm">{t.name} ({t.tier})</div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 items-end">
          <div>
            <Label>Template</Label>
            <Select value={templateKey} onValueChange={(v) => setTemplateKey(v)}>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Content>{(templates?.templates || []).map((t) => <Select.Item key={t.key} value={t.key}>{t.name}</Select.Item>)}</Select.Content>
            </Select>
          </div>
          <div><Label>Name</Label><Input value={newStorefrontName} onChange={(e) => setNewStorefrontName(e.target.value)} /></div>
          <div><Label>Slug</Label><Input value={newStorefrontSlug} onChange={(e) => setNewStorefrontSlug(e.target.value)} /></div>
        </div>
        <Button className="mt-3" onClick={createFromTemplate}>Create storefront from template</Button>
      </Container>

      <Container>
        <Heading>CSV importer</Heading>
        <Text size="small" className="text-ui-fg-subtle">Field mapping + validation errors with Shopify CSV-compatible preset.</Text>
        <div className="mt-3">
          <Label>Preset</Label>
          <Select value={preset} onValueChange={(v: any) => setPreset(v)}>
            <Select.Trigger><Select.Value /></Select.Trigger>
            <Select.Content>
              <Select.Item value="shopify">Shopify CSV preset</Select.Item>
              <Select.Item value="custom">Custom mapping</Select.Item>
            </Select.Content>
          </Select>
          <Label className="mt-3">CSV</Label>
          <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={6} />
          <Button className="mt-3" onClick={runImporter}>Validate import</Button>
        </div>
        {importResult && (
          <div className="mt-3 text-sm">
            <div>Total rows: {importResult.total_rows} / Valid rows: {importResult.valid_rows}</div>
            <div className="mt-2">Errors:</div>
            <ul className="list-disc pl-6">{(importResult.errors || []).slice(0, 10).map((e: any, i: number) => <li key={i}>Row {e.row} [{e.field}] {e.message}</li>)}</ul>
          </div>
        )}
      </Container>

      <Container>
        <Heading>Sandbox mode</Heading>
        <Text size="small" className="text-ui-fg-subtle">Enable test payments and order simulation for this storefront.</Text>
        <div className="mt-3 flex gap-2">
          <Button variant={(currentStorefront?.metadata as any)?.sandbox_mode ? "primary" : "secondary"} onClick={() => setSandboxMode(true)}>Enable sandbox</Button>
          <Button variant={!(currentStorefront?.metadata as any)?.sandbox_mode ? "primary" : "secondary"} onClick={() => setSandboxMode(false)}>Disable sandbox</Button>
        </div>
      </Container>

      <Container>
        <Heading>Donation settlement mode</Heading>
        <Text size="small" className="text-ui-fg-subtle">Toggle between split processor and ledger batch settlement.</Text>
        <div className="mt-3 flex gap-2">
          <Button variant={settings?.settings?.settlement_mode === "split_processor" ? "primary" : "secondary"} onClick={() => updateMode("split_processor")}>split_processor</Button>
          <Button variant={settings?.settings?.settlement_mode === "ledger_batch" ? "primary" : "secondary"} onClick={() => updateMode("ledger_batch")}>ledger_batch</Button>
        </div>
      </Container>

      <Container>
        <Heading>Beneficiary management</Heading>
        <Text size="small" className="text-ui-fg-subtle">Verification status for beneficiary organizations.</Text>
        <div className="mt-4 space-y-3">
          {data?.beneficiaries?.map((b) => (
            <div key={b.id} className="border rounded p-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{b.name}</div>
                <div className="text-xs text-ui-fg-subtle">Status: {b.verification_status}</div>
              </div>
              <Select value={b.verification_status} onValueChange={(v) => updateStatus(b.id, v)}>
                <Select.Trigger><Select.Value placeholder="Select status" /></Select.Trigger>
                <Select.Content>
                  <Select.Item value="pending">pending</Select.Item>
                  <Select.Item value="verified">verified</Select.Item>
                  <Select.Item value="rejected">rejected</Select.Item>
                </Select.Content>
              </Select>
            </div>
          ))}
        </div>
      </Container>
    </div>
  )
}

export const Component = DonationsPage
