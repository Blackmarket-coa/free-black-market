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
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Trash } from "@medusajs/icons"
import {
  useNurseryProducts,
  useUpsertNurseryProduct,
  useDeleteNurseryProduct,
  NURSERY_SUBTYPES,
  type NurserySubtype,
} from "../../../hooks/api/nursery"

const SUBTYPE_LABELS: Record<NurserySubtype, string> = {
  live_plant_liner: "Live plant — liner",
  live_plant_3_4in: 'Live plant — 3–4"',
  live_plant_1gal: "Live plant — 1 gal",
  live_plant_3gal: "Live plant — 3 gal",
  bare_root_dormant: "Bare-root / dormant",
  cuttings_pads_bulk: "Cuttings & pads (bulk)",
  divisions_pups_slips_bulk: "Divisions / pups / slips (bulk)",
  seed_packet: "Seed packet",
  dried_value_added_by_weight: "Dried / value-added (by weight)",
}

const csv = (s: string) =>
  s.split(",").map((x) => x.trim()).filter(Boolean)

const NurseryListingsPage = () => {
  const { data, isLoading } = useNurseryProducts()
  const upsert = useUpsertNurseryProduct()
  const del = useDeleteNurseryProduct()
  const prompt = usePrompt()

  const [productId, setProductId] = useState("")
  const [subtype, setSubtype] = useState<NurserySubtype>("live_plant_1gal")
  const [hardiness, setHardiness] = useState("")
  const [propagation, setPropagation] = useState("")
  const [edible, setEdible] = useState("")
  const [medicinal, setMedicinal] = useState("")
  const [cost, setCost] = useState("")

  const handleSave = async () => {
    if (!productId) {
      toast.error("Enter the product id to attach attributes to")
      return
    }
    try {
      await upsert.mutateAsync({
        product_id: productId,
        subtype,
        hardiness_zone: hardiness || undefined,
        propagation_method: propagation || undefined,
        edible_use: edible ? csv(edible) : undefined,
        medicinal_use: medicinal ? csv(medicinal) : undefined,
        cost_to_produce: cost ? Number(cost) : undefined,
      })
      toast.success("Nursery attributes saved")
      setProductId("")
    } catch {
      toast.error("Could not save")
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await prompt({
      title: "Remove nursery attributes",
      description: "This removes the nursery attributes for this product. The product itself is untouched.",
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
        <Heading level="h1">Nursery Listings</Heading>
        <Text className="text-ui-fg-subtle">
          Add nursery-specific attributes to your products (pot size, hardiness,
          propagation, use, channel fit). These drive plant-tag data and feed the
          FSA loan quest when you opt in — but this page is fully usable on its own.
        </Text>
      </Container>

      <Container>
        <Heading level="h2" className="mb-3">
          Add / update a listing
        </Heading>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Text size="small" className="mb-1">Product ID</Text>
            <Input value={productId} placeholder="prod_…" onChange={(e) => setProductId(e.target.value)} />
          </div>
          <div>
            <Text size="small" className="mb-1">Subtype</Text>
            <Select value={subtype} onValueChange={(v) => setSubtype(v as NurserySubtype)}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {NURSERY_SUBTYPES.map((s) => (
                  <Select.Item key={s} value={s}>
                    {SUBTYPE_LABELS[s]}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div>
            <Text size="small" className="mb-1">Hardiness zone</Text>
            <Input value={hardiness} placeholder="7a–9b" onChange={(e) => setHardiness(e.target.value)} />
          </div>
          <div>
            <Text size="small" className="mb-1">Propagation method</Text>
            <Input value={propagation} placeholder="cutting" onChange={(e) => setPropagation(e.target.value)} />
          </div>
          <div>
            <Text size="small" className="mb-1">Edible use (comma-separated)</Text>
            <Input value={edible} placeholder="tea, tincture" onChange={(e) => setEdible(e.target.value)} />
          </div>
          <div>
            <Text size="small" className="mb-1">Medicinal use (comma-separated)</Text>
            <Input value={medicinal} placeholder="immune, sleep" onChange={(e) => setMedicinal(e.target.value)} />
          </div>
          <div>
            <Text size="small" className="mb-1">Cost to produce ($/unit)</Text>
            <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={handleSave} isLoading={upsert.isPending}>Save listing</Button>
        </div>
      </Container>

      <Container>
        <Heading level="h2" className="mb-2">Your nursery listings</Heading>
        {isLoading ? (
          <Text className="text-ui-fg-subtle">Loading…</Text>
        ) : (data?.attributes ?? []).length === 0 ? (
          <Text className="text-ui-fg-subtle">No nursery listings yet.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Product</Table.HeaderCell>
                <Table.HeaderCell>Subtype</Table.HeaderCell>
                <Table.HeaderCell>Zone</Table.HeaderCell>
                <Table.HeaderCell>Propagation</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data!.attributes.map((a) => (
                <Table.Row key={a.id}>
                  <Table.Cell>{a.product_id}</Table.Cell>
                  <Table.Cell>
                    <Badge size="2xsmall">{SUBTYPE_LABELS[a.subtype] ?? a.subtype}</Badge>
                  </Table.Cell>
                  <Table.Cell>{a.hardiness_zone ?? "—"}</Table.Cell>
                  <Table.Cell>{a.propagation_method ?? "—"}</Table.Cell>
                  <Table.Cell>
                    <IconButton size="small" variant="transparent" onClick={() => handleDelete(a.id)}>
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

export default NurseryListingsPage
