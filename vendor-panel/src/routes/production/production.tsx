import { useState } from "react"
import {
  Container,
  Heading,
  Text,
  Button,
  Input,
  Select,
  Table,
  Badge,
  IconButton,
  Switch,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Trash } from "@medusajs/icons"
import {
  useProductionBatches,
  useCreateProductionBatch,
  useDeleteProductionBatch,
  type ProductionSource,
} from "../../hooks/api/production"

const SOURCES: ProductionSource[] = ["own", "foraged", "swap", "purchased"]

const ProductionPage = () => {
  const { data, isLoading } = useProductionBatches()
  const create = useCreateProductionBatch()
  const del = useDeleteProductionBatch()
  const prompt = usePrompt()

  const [label, setLabel] = useState("")
  const [method, setMethod] = useState("")
  const [qty, setQty] = useState("")
  const [source, setSource] = useState<ProductionSource>("own")
  const [controlled, setControlled] = useState(false)
  const [yieldQty, setYieldQty] = useState("")

  const handleCreate = async () => {
    if (!label) {
      toast.error("What was produced? Add an item label")
      return
    }
    try {
      await create.mutateAsync({
        item_label: label,
        method: method || undefined,
        qty_started: qty ? Number(qty) : 0,
        source,
        controlled_environment: controlled,
        yield_qty: yieldQty ? Number(yieldQty) : undefined,
      })
      toast.success("Batch recorded")
      setLabel("")
      setMethod("")
      setQty("")
      setYieldQty("")
    } catch {
      toast.error("Could not record batch")
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await prompt({
      title: "Remove batch",
      description: "Remove this production batch?",
      confirmText: "Remove",
      cancelText: "Cancel",
    })
    if (!ok) return
    try {
      await del.mutateAsync(id)
      toast.success("Removed")
    } catch {
      toast.error("Could not remove")
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container>
        <Heading level="h1">Production Ledger</Heading>
        <Text className="text-ui-fg-subtle">
          Record what you make or grow — propagation batches, production runs — by
          method, quantity, and yield. Optional, and independent of any quest;
          quests that need production data read from here when you opt in.
        </Text>
      </Container>

      <Container>
        <Heading level="h2" className="mb-3">Record a batch</Heading>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Text size="small" className="mb-1">Item</Text>
            <Input value={label} placeholder="Elderberry liners" onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <Text size="small" className="mb-1">Method</Text>
            <Input value={method} placeholder="softwood cutting" onChange={(e) => setMethod(e.target.value)} />
          </div>
          <div>
            <Text size="small" className="mb-1">Quantity started</Text>
            <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <Text size="small" className="mb-1">Source</Text>
            <Select value={source} onValueChange={(v) => setSource(v as ProductionSource)}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {SOURCES.map((s) => (
                  <Select.Item key={s} value={s}>
                    {s}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div>
            <Text size="small" className="mb-1">Yield (units, optional)</Text>
            <Input type="number" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={controlled} onCheckedChange={setControlled} id="ce" />
            <Text size="small" as="label" htmlFor="ce">Controlled environment</Text>
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={handleCreate} isLoading={create.isPending}>Record batch</Button>
        </div>
      </Container>

      <Container>
        <Heading level="h2" className="mb-2">Your batches</Heading>
        {isLoading ? (
          <Text className="text-ui-fg-subtle">Loading…</Text>
        ) : (data?.production_batches ?? []).length === 0 ? (
          <Text className="text-ui-fg-subtle">No batches recorded yet.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Item</Table.HeaderCell>
                <Table.HeaderCell>Method</Table.HeaderCell>
                <Table.HeaderCell>Started</Table.HeaderCell>
                <Table.HeaderCell>Yield</Table.HeaderCell>
                <Table.HeaderCell>Source</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data!.production_batches.map((b) => (
                <Table.Row key={b.id}>
                  <Table.Cell>{b.item_label}</Table.Cell>
                  <Table.Cell>{b.method ?? "—"}</Table.Cell>
                  <Table.Cell>{b.qty_started}</Table.Cell>
                  <Table.Cell>{b.yield_qty ?? "—"}</Table.Cell>
                  <Table.Cell>
                    <Badge size="2xsmall">{b.source}</Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <IconButton size="small" variant="transparent" onClick={() => handleDelete(b.id)}>
                      <Trash />
                    </IconButton>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </div>
  )
}

export default ProductionPage
