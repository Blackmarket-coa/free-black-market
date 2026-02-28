import { useQuery } from "@tanstack/react-query"
import { Button, Container, Heading, Select, Text } from "@medusajs/ui"
import { sdk } from "@lib/client"

export const DonationsPage = () => {
  const { data, refetch } = useQuery({
    queryKey: ["donations-beneficiaries"],
    queryFn: () => sdk.client.fetch<{ beneficiaries: any[] }>("/admin/donations/beneficiaries"),
  })

  const { data: settings, refetch: refetchSettings } = useQuery({
    queryKey: ["donations-settings"],
    queryFn: () => sdk.client.fetch<{ settings: any }>("/admin/donations/settings"),
  })

  const updateStatus = async (id: string, verification_status: string) => {
    const target = data?.beneficiaries?.find((b) => b.id === id)
    if (!target) return
    await sdk.client.fetch("/admin/donations/beneficiaries", {
      method: "PATCH",
      body: { ...target, verification_status },
    })
    refetch()
  }

  const updateMode = async (mode: "split_processor" | "ledger_batch") => {
    await sdk.client.fetch("/admin/donations/settings", {
      method: "POST",
      body: { settlement_mode: mode },
    })
    refetchSettings()
  }

  return (
    <div className="flex flex-col gap-4">
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
                <Select.Trigger>
                  <Select.Value placeholder="Select status" />
                </Select.Trigger>
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
