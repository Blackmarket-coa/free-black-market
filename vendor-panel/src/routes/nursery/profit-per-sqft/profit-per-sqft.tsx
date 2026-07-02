import { useState } from "react"
import {
  Container,
  Heading,
  Text,
  Button,
  Input,
  Table,
  Badge,
  IconButton,
  toast,
} from "@medusajs/ui"
import { PlusMini, Trash } from "@medusajs/icons"
import {
  useProfitPerSqFt,
  type ProfitPerSqFtInput,
  type ProfitPerSqFtResult,
} from "../../../hooks/api/quests"

interface Row extends ProfitPerSqFtInput {
  _id: number
}

let nextId = 1
const blankRow = (): Row => ({
  _id: nextId++,
  label: "",
  sellPrice: 0,
  costToProduce: 0,
  footprintSqFtPerUnit: 0.25,
  weeksToSell: 12,
  stackLevels: 1,
})

/**
 * Profit-per-sqft decision-support view. Fully usable with NO quest enrolled —
 * it's a growing/pricing planner, deliberately separate from lender-grade
 * exports (its estimate/override inputs never enter a quest packet).
 */
const ProfitPerSqFtPage = () => {
  const [rows, setRows] = useState<Row[]>([blankRow()])
  const [ranking, setRanking] = useState<ProfitPerSqFtResult[] | null>(null)
  const compute = useProfitPerSqFt()

  const update = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)))
  const remove = (id: number) => setRows((rs) => rs.filter((r) => r._id !== id))
  const num = (v: string) => (v === "" ? 0 : Number(v))

  const handleCompute = async () => {
    try {
      const res = await compute.mutateAsync(
        rows.map(({ _id, ...rest }) => rest)
      )
      setRanking(res.ranking)
    } catch (e: any) {
      toast.error(e?.message ?? "Check your inputs (footprint and weeks must be > 0)")
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container>
        <Heading level="h1">Profit per Square Foot</Heading>
        <Text className="text-ui-fg-subtle">
          Compare crops by how much profit each earns per square foot per year.
          Decision-support only — this planner is separate from any lender packet.
          Supports vertical stacking (a shelf level counts as its own sqft).
        </Text>
      </Container>

      <Container>
        <div className="mb-3 flex items-center justify-between">
          <Heading level="h2">Inputs</Heading>
          <Button
            size="small"
            variant="secondary"
            onClick={() => setRows((rs) => [...rs, blankRow()])}
          >
            <PlusMini /> Add crop
          </Button>
        </div>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Crop</Table.HeaderCell>
              <Table.HeaderCell>Sell $</Table.HeaderCell>
              <Table.HeaderCell>Cost $</Table.HeaderCell>
              <Table.HeaderCell>SqFt/unit</Table.HeaderCell>
              <Table.HeaderCell>Weeks to sell</Table.HeaderCell>
              <Table.HeaderCell>Stack levels</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((r) => (
              <Table.Row key={r._id}>
                <Table.Cell>
                  <Input
                    value={r.label}
                    placeholder="e.g. Elderberry liner"
                    onChange={(e) => update(r._id, { label: e.target.value })}
                  />
                </Table.Cell>
                <Table.Cell>
                  <Input
                    type="number"
                    value={String(r.sellPrice)}
                    onChange={(e) => update(r._id, { sellPrice: num(e.target.value) })}
                  />
                </Table.Cell>
                <Table.Cell>
                  <Input
                    type="number"
                    value={String(r.costToProduce)}
                    onChange={(e) => update(r._id, { costToProduce: num(e.target.value) })}
                  />
                </Table.Cell>
                <Table.Cell>
                  <Input
                    type="number"
                    value={String(r.footprintSqFtPerUnit)}
                    onChange={(e) =>
                      update(r._id, { footprintSqFtPerUnit: num(e.target.value) })
                    }
                  />
                </Table.Cell>
                <Table.Cell>
                  <Input
                    type="number"
                    value={String(r.weeksToSell)}
                    onChange={(e) => update(r._id, { weeksToSell: num(e.target.value) })}
                  />
                </Table.Cell>
                <Table.Cell>
                  <Input
                    type="number"
                    value={String(r.stackLevels ?? 1)}
                    onChange={(e) => update(r._id, { stackLevels: num(e.target.value) })}
                  />
                </Table.Cell>
                <Table.Cell>
                  <IconButton
                    size="small"
                    variant="transparent"
                    onClick={() => remove(r._id)}
                    disabled={rows.length === 1}
                  >
                    <Trash />
                  </IconButton>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        <div className="mt-3">
          <Button onClick={handleCompute} isLoading={compute.isPending}>
            Rank by annual profit / sqft
          </Button>
        </div>
      </Container>

      {ranking ? (
        <Container>
          <Heading level="h2" className="mb-3">
            Ranking
          </Heading>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Rank</Table.HeaderCell>
                <Table.HeaderCell>Crop</Table.HeaderCell>
                <Table.HeaderCell>Profit/unit</Table.HeaderCell>
                <Table.HeaderCell>Turns/yr</Table.HeaderCell>
                <Table.HeaderCell>Annual profit/sqft</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {ranking.map((r, i) => (
                <Table.Row key={i}>
                  <Table.Cell>
                    {i === 0 ? <Badge color="green">#1</Badge> : `#${i + 1}`}
                  </Table.Cell>
                  <Table.Cell>{r.label || "—"}</Table.Cell>
                  <Table.Cell>${r.profitPerUnit.toFixed(2)}</Table.Cell>
                  <Table.Cell>{r.turnsPerYear.toFixed(1)}</Table.Cell>
                  <Table.Cell>
                    <Text weight="plus">${r.annualProfitPerSqFt.toFixed(2)}</Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      ) : null}
    </div>
  )
}

export default ProfitPerSqFtPage
