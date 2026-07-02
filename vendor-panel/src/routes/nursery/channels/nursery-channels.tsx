import { useState } from "react"
import {
  Container,
  Heading,
  Text,
  Button,
  Input,
  Select,
  Table,
  toast,
} from "@medusajs/ui"
import {
  useNurseryChannels,
  useCreateChannelTier,
} from "../../../hooks/api/nursery"

const NurseryChannelsPage = () => {
  const { data, isLoading } = useNurseryChannels()
  const create = useCreateChannelTier()

  const [channel, setChannel] = useState("")
  const [discount, setDiscount] = useState("")
  const [terms, setTerms] = useState("")

  const handleCreate = async () => {
    if (!channel || discount === "") {
      toast.error("Pick a channel and enter a discount %")
      return
    }
    try {
      await create.mutateAsync({
        channel,
        discountPercent: Number(discount),
        paymentTermsDays: terms ? Number(terms) : undefined,
      })
      toast.success("Channel pricing created")
      setDiscount("")
      setTerms("")
    } catch {
      toast.error("Could not create channel pricing")
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container>
        <Heading level="h1">Wholesale Channels</Heading>
        <Text className="text-ui-fg-subtle">
          Set per-channel wholesale pricing for apothecaries, retail shops, and
          food-forest installers. These use FBM's existing customer-tier pricing —
          no separate price list — so discounts and terms flow straight through to
          orders.
        </Text>
      </Container>

      <Container>
        <Heading level="h2" className="mb-3">Add channel pricing</Heading>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Text size="small" className="mb-1">Channel</Text>
            <Select value={channel} onValueChange={setChannel}>
              <Select.Trigger>
                <Select.Value placeholder="Choose a channel" />
              </Select.Trigger>
              <Select.Content>
                {(data?.channels ?? []).map((c) => (
                  <Select.Item key={c.key} value={c.key}>
                    {c.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div className="flex-1">
            <Text size="small" className="mb-1">Discount %</Text>
            <Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div className="flex-1">
            <Text size="small" className="mb-1">Payment terms (days)</Text>
            <Input type="number" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
          <Button onClick={handleCreate} isLoading={create.isPending}>Add</Button>
        </div>
      </Container>

      <Container>
        <Heading level="h2" className="mb-2">Your channel pricing</Heading>
        {isLoading ? (
          <Text className="text-ui-fg-subtle">Loading…</Text>
        ) : (data?.tiers ?? []).length === 0 ? (
          <Text className="text-ui-fg-subtle">No channel pricing set yet.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Channel</Table.HeaderCell>
                <Table.HeaderCell>Discount</Table.HeaderCell>
                <Table.HeaderCell>Terms</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data!.tiers.map((t) => (
                <Table.Row key={t.id}>
                  <Table.Cell>{t.name}</Table.Cell>
                  <Table.Cell>{t.discount_percent}%</Table.Cell>
                  <Table.Cell>{t.payment_terms_days ? `Net ${t.payment_terms_days}` : "—"}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </div>
  )
}

export default NurseryChannelsPage
