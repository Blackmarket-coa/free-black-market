import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  Container,
  Heading,
  Text,
  Button,
  Input,
  Label,
  Table,
  Badge,
  Alert,
  Switch,
  toast,
} from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import { sdk } from "../../../lib/sdk"
import {
  useSalesLedger,
  useComplianceSnapshot,
  useInvalidateCottageFood,
  formatUsd,
  formatDate,
} from "../_shared"

const SOURCE_LABELS: Record<string, string> = {
  medusa_order: "Order",
  food_order: "Food order",
  manual: "Entered by you",
}

/**
 * The compliance ledger, plus the form for recording sales made off-platform.
 *
 * That form is the point of this page. A home producer's farmers-market and
 * cash sales count toward the same cap as their online orders, so a meter fed
 * only by platform orders understates the number they'd actually have to
 * report — which is the failure mode that lets someone sail past a limit
 * believing they had room.
 */
const CottageFoodSalesPage = () => {
  const navigate = useNavigate()
  const { data, isLoading } = useSalesLedger()
  const { data: snapshot } = useComplianceSnapshot()
  const invalidate = useInvalidateCottageFood()

  const [amount, setAmount] = useState("")
  const [meals, setMeals] = useState("")
  const [occurredAt, setOccurredAt] = useState(
    new Date().toISOString().slice(0, 10)
  )
  const [note, setNote] = useState("")
  const [countsTowardAnnual, setCountsTowardAnnual] = useState(true)

  const record = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch("/vendor/cottage-food/sales", { method: "POST", body }),
    onSuccess: () => {
      invalidate()
      setAmount("")
      setMeals("")
      setNote("")
      toast.success("Recorded")
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const submit = () => {
    const dollars = Number(amount.replace(/[$,]/g, "")) || 0
    const mealCount = Number(meals) || 0
    if (!dollars && !mealCount) {
      toast.error("Enter an amount, a meal count, or both")
      return
    }
    record.mutate({
      amount_cents: Math.round(dollars * 100),
      meal_count: Math.trunc(mealCount),
      // Noon local, so a date-only entry can't drift into the previous day
      // once it's converted to UTC.
      occurred_at: new Date(`${occurredAt}T12:00:00`).toISOString(),
      counts_toward_annual: countsTowardAnnual,
      note,
    })
  }

  const tracksMeals = snapshot?.tracks_meals ?? false
  const entries = data?.entries ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Sales log</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Everything counted toward the limits you set.
          </Text>
        </div>
        <Button variant="secondary" size="small" onClick={() => navigate("/cottage-food")}>
          Back
        </Button>
      </div>

      <div className="flex flex-col gap-y-4 px-6 py-6">
        <Heading level="h2">Record a sale made elsewhere</Heading>
        <Alert variant="info" className="max-w-3xl">
          Markets, cash, custom orders — anything that counts toward your cap but
          didn't go through Free Black Market. Backdate it and it lands in the
          period it belongs to.
        </Alert>
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <Label size="small">Amount (USD)</Label>
            <Input
              placeholder="120.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {tracksMeals && (
            <div>
              <Label size="small">Meals</Label>
              <Input
                placeholder="8"
                value={meals}
                onChange={(e) => setMeals(e.target.value)}
              />
            </div>
          )}
          <div>
            <Label size="small">Date</Label>
            <Input
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>
          <div>
            <Label size="small">Note</Label>
            <Input
              placeholder="Saturday market"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-x-3">
          <Switch
            checked={countsTowardAnnual}
            onCheckedChange={setCountsTowardAnnual}
          />
          <Text size="small">Counts toward my annual cap</Text>
        </div>
        <div>
          <Button onClick={submit} isLoading={record.isPending}>
            Record
          </Button>
        </div>
      </div>

      <div className="px-6 py-6">
        <Heading level="h2" className="mb-4">
          History
        </Heading>
        {isLoading ? (
          <Text className="text-ui-fg-subtle">Loading…</Text>
        ) : entries.length === 0 ? (
          <Text className="text-ui-fg-subtle">
            Nothing recorded yet. Orders placed through Free Black Market show up
            here automatically.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Date</Table.HeaderCell>
                <Table.HeaderCell>Source</Table.HeaderCell>
                <Table.HeaderCell>Amount</Table.HeaderCell>
                {tracksMeals && <Table.HeaderCell>Meals</Table.HeaderCell>}
                <Table.HeaderCell>Note</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {entries.map((entry) => (
                <Table.Row key={entry.id}>
                  <Table.Cell>{formatDate(entry.occurred_at)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-x-2">
                      <Badge size="2xsmall" color={entry.source === "manual" ? "blue" : "grey"}>
                        {SOURCE_LABELS[entry.source] ?? entry.source}
                      </Badge>
                      {entry.reverses_entry_id && (
                        <Badge size="2xsmall" color="orange">
                          Reversal
                        </Badge>
                      )}
                      {!entry.counts_toward_annual && (
                        <Badge size="2xsmall" color="grey">
                          Not counted
                        </Badge>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>{formatUsd(Number(entry.amount_cents))}</Table.Cell>
                  {tracksMeals && <Table.Cell>{entry.meal_count || "—"}</Table.Cell>}
                  <Table.Cell className="text-ui-fg-subtle">
                    {entry.note || "—"}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}

export default CottageFoodSalesPage
