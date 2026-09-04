import { useMemo, useState } from "react"
import { Outlet } from "react-router-dom"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { CurrencyDollar, ExclamationCircle, DocumentText } from "@medusajs/icons"
import { SingleColumnPage } from "../../../components/layout/pages"
import { useDashboardExtension } from "../../../extensions"
import {
  useCreateFund,
  useFundEntries,
  useFundPortfolio,
  useRecordFundEntry,
} from "../../../hooks/api/funds"

const RESTRICTIONS = [
  { value: "unrestricted", label: "Unrestricted" },
  { value: "purpose", label: "Purpose-restricted" },
  { value: "time", label: "Time-restricted" },
  { value: "purpose_and_time", label: "Purpose and time" },
  { value: "permanent", label: "Permanently restricted" },
]

const ENTRY_TYPES = [
  { value: "award", label: "Award — grantor commits money" },
  { value: "receipt", label: "Receipt — cash received" },
  { value: "expenditure", label: "Expenditure — money spent" },
  { value: "release", label: "Release — restriction satisfied" },
  { value: "return", label: "Return — unspent money returned" },
]

const money = (cents: number | undefined | null) =>
  `$${((Number(cents ?? 0)) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

interface Violation {
  code: string
  severity: "error" | "warning"
  message: string
}

interface Report {
  fund_id: string
  code: string
  name: string
  restriction: string
  rollup: {
    awarded_cents: number
    received_cents: number
    spent_cents: number
    returned_cents: number
    receivable_cents: number
    unspent_award_cents: number
    cash_available_cents: number
  }
  violations: Violation[]
  spend_headroom_cents: number | null
}

export function FundsList() {
  const { getWidgets } = useDashboardExtension()
  const { data, isLoading } = useFundPortfolio()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNewFund, setShowNewFund] = useState(false)

  const reports: Report[] = useMemo(() => data?.reports ?? [], [data])
  const selected = reports.find((r) => r.fund_id === selectedId) ?? null

  const totals = useMemo(
    () =>
      reports.reduce(
        (acc, r) => ({
          awarded: acc.awarded + Number(r.rollup?.awarded_cents ?? 0),
          unspent: acc.unspent + Number(r.rollup?.unspent_award_cents ?? 0),
          cash: acc.cash + Number(r.rollup?.cash_available_cents ?? 0),
        }),
        { awarded: 0, unspent: 0, cash: 0 }
      ),
    [reports]
  )

  const flagged = reports.filter((r) => (r.violations?.length ?? 0) > 0)

  return (
    <SingleColumnPage
      widgets={{
        before: getWidgets("fund.list.before"),
        after: getWidgets("fund.list.after"),
      }}
    >
      <Container className="p-8 space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <Heading level="h1" className="text-2xl">
              Funds &amp; Grants
            </Heading>
            <Text className="text-ui-fg-subtle mt-1">
              Money held under donor intent — what is left of each award, and
              whether it was spent as designated.
            </Text>
          </div>
          <Button variant="secondary" onClick={() => setShowNewFund((v) => !v)}>
            {showNewFund ? "Cancel" : "Open a fund"}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SummaryCard label="Awarded" value={money(totals.awarded)} tone="neutral" />
          <SummaryCard
            label="Unspent award"
            value={money(totals.unspent)}
            tone="neutral"
          />
          <SummaryCard label="Cash on hand" value={money(totals.cash)} tone="neutral" />
        </div>

        {flagged.length > 0 && (
          <div className="rounded-xl border border-ui-border-error bg-ui-bg-subtle p-4">
            <div className="flex items-center gap-2 mb-1">
              <ExclamationCircle className="text-ui-fg-error" />
              <Text weight="plus">
                {flagged.length} fund{flagged.length === 1 ? "" : "s"} need
                attention
              </Text>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              A finding here is what a grant reconciliation has to explain.
              Select a fund to see the detail.
            </Text>
          </div>
        )}

        {showNewFund && (
          <NewFundForm onDone={() => setShowNewFund(false)} />
        )}

        {isLoading ? (
          <Text className="text-ui-fg-subtle">Loading funds…</Text>
        ) : reports.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2">
            {reports.map((report) => (
              <FundRow
                key={report.fund_id}
                report={report}
                isSelected={report.fund_id === selectedId}
                onSelect={() =>
                  setSelectedId((cur) =>
                    cur === report.fund_id ? null : report.fund_id
                  )
                }
              />
            ))}
          </div>
        )}

        {selected && <FundDetail report={selected} />}
      </Container>
      <Outlet />
    </SingleColumnPage>
  )
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "neutral" | "error"
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        tone === "error" ? "border-ui-border-error" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <CurrencyDollar className="text-ui-fg-subtle" />
        <Text size="small" className="text-ui-fg-subtle">
          {label}
        </Text>
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  )
}

function FundRow({
  report,
  isSelected,
  onSelect,
}: {
  report: Report
  isSelected: boolean
  onSelect: () => void
}) {
  const errors = report.violations.filter((v) => v.severity === "error").length
  const warnings = report.violations.filter((v) => v.severity === "warning").length

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-4 transition hover:bg-ui-bg-subtle ${
        isSelected ? "border-ui-border-interactive" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Text weight="plus" className="truncate">
              {report.name}
            </Text>
            <Badge size="2xsmall">{report.code}</Badge>
            <Badge size="2xsmall" color="grey">
              {report.restriction.replace(/_/g, " ")}
            </Badge>
          </div>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            {money(report.rollup?.unspent_award_cents)} unspent of{" "}
            {money(report.rollup?.awarded_cents)} awarded ·{" "}
            {money(report.rollup?.cash_available_cents)} cash on hand
          </Text>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {errors > 0 && <Badge color="red">{errors} error{errors === 1 ? "" : "s"}</Badge>}
          {warnings > 0 && (
            <Badge color="orange">{warnings} warning{warnings === 1 ? "" : "s"}</Badge>
          )}
          {errors === 0 && warnings === 0 && <Badge color="green">Clean</Badge>}
        </div>
      </div>
    </button>
  )
}

function FundDetail({ report }: { report: Report }) {
  const { data: entriesData } = useFundEntries(report.fund_id)
  const entries = entriesData?.fund_transactions ?? []

  return (
    <div className="rounded-xl border p-6 space-y-6">
      <div>
        <Heading level="h2" className="text-lg">
          {report.name}
        </Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {report.spend_headroom_cents === null
            ? "No spend limit enforced on this fund."
            : `${money(report.spend_headroom_cents)} may still be spent.`}
        </Text>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Figure label="Awarded" value={money(report.rollup?.awarded_cents)} />
        <Figure label="Received" value={money(report.rollup?.received_cents)} />
        <Figure label="Spent" value={money(report.rollup?.spent_cents)} />
        <Figure
          label="Receivable"
          value={money(report.rollup?.receivable_cents)}
          hint="Awarded but not yet in hand"
        />
      </div>

      {report.violations.length > 0 && (
        <div className="space-y-2">
          <Heading level="h3" className="text-base">
            Findings
          </Heading>
          {report.violations.map((v, i) => (
            <div
              key={`${v.code}-${i}`}
              className="rounded-lg border p-3 flex items-start gap-3"
            >
              <Badge color={v.severity === "error" ? "red" : "orange"} size="2xsmall">
                {v.severity}
              </Badge>
              <div>
                <Text size="small" weight="plus">
                  {v.code.replace(/_/g, " ")}
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {v.message}
                </Text>
              </div>
            </div>
          ))}
        </div>
      )}

      <RecordEntryForm fundId={report.fund_id} />

      <div className="space-y-2">
        <Heading level="h3" className="text-base">
          Movements
        </Heading>
        {entries.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No movements recorded yet.
          </Text>
        ) : (
          entries.map((e: Record<string, unknown>) => (
            <div
              key={String(e.id)}
              className="rounded-lg border p-3 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <Text size="small" weight="plus">
                  {String(e.entry_type).replace(/_/g, " ")}
                </Text>
                <Text size="small" className="text-ui-fg-subtle truncate">
                  {String(e.description ?? "—")}
                  {e.program_id ? ` · program ${String(e.program_id)}` : ""}
                </Text>
              </div>
              <Text size="small">{money(Number(e.amount_cents))}</Text>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border p-3">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <div className="text-lg font-semibold">{value}</div>
      {hint && (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      )}
    </div>
  )
}

function RecordEntryForm({ fundId }: { fundId: string }) {
  const record = useRecordFundEntry(fundId)
  const [entryType, setEntryType] = useState("receipt")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [programId, setProgramId] = useState("")
  const [occurredAt, setOccurredAt] = useState("")

  const submit = () => {
    const dollars = Number(amount)
    if (!Number.isFinite(dollars) || dollars === 0) {
      toast.error("Enter an amount")
      return
    }

    record.mutate(
      {
        entry_type: entryType,
        amount_cents: Math.round(dollars * 100),
        description: description || undefined,
        program_id: programId || undefined,
        occurred_at: occurredAt || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Movement recorded")
          setAmount("")
          setDescription("")
        },
        // The backend refuses an overspend or an out-of-period spend with a
        // 409 and an explanatory message; surfacing it verbatim is the point.
        onError: (error: Error) => toast.error(error.message),
      }
    )
  }

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <Heading level="h3" className="text-base">
        Record a movement
      </Heading>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <Text size="small" className="mb-1">
            Type
          </Text>
          <Select value={entryType} onValueChange={setEntryType}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {ENTRY_TYPES.map((t) => (
                <Select.Item key={t.value} value={t.value}>
                  {t.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </label>
        <label className="block">
          <Text size="small" className="mb-1">
            Amount (USD)
          </Text>
          <Input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label className="block">
          <Text size="small" className="mb-1">
            Program (for purpose compliance)
          </Text>
          <Input
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            placeholder="prog_meals"
          />
        </label>
        <label className="block">
          <Text size="small" className="mb-1">
            Occurred at
          </Text>
          <Input
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </label>
      </div>
      <label className="block">
        <Text size="small" className="mb-1">
          Description
        </Text>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </label>
      <Button onClick={submit} isLoading={record.isPending}>
        Record
      </Button>
    </div>
  )
}

function NewFundForm({ onDone }: { onDone: () => void }) {
  const create = useCreateFund()
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [restriction, setRestriction] = useState("unrestricted")
  const [designatedProgramId, setDesignatedProgramId] = useState("")
  const [grantorName, setGrantorName] = useState("")
  const [spendFrom, setSpendFrom] = useState("")
  const [spendUntil, setSpendUntil] = useState("")

  const needsProgram = restriction === "purpose" || restriction === "purpose_and_time"
  const needsWindow = restriction === "time" || restriction === "purpose_and_time"

  const submit = () => {
    if (!name || !code) {
      toast.error("Name and code are required")
      return
    }

    create.mutate(
      {
        name,
        code,
        restriction,
        designated_program_id: designatedProgramId || undefined,
        grantor_name: grantorName || undefined,
        spend_from: spendFrom || undefined,
        spend_until: spendUntil || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Fund opened")
          onDone()
        },
        onError: (error: Error) => toast.error(error.message),
      }
    )
  }

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <Heading level="h3" className="text-base">
        Open a fund
      </Heading>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <Text size="small" className="mb-1">
            Name
          </Text>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <Text size="small" className="mb-1">
            Code
          </Text>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="LFPA-24"
          />
        </label>
        <label className="block">
          <Text size="small" className="mb-1">
            Restriction
          </Text>
          <Select value={restriction} onValueChange={setRestriction}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {RESTRICTIONS.map((r) => (
                <Select.Item key={r.value} value={r.value}>
                  {r.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </label>
        <label className="block">
          <Text size="small" className="mb-1">
            Grantor
          </Text>
          <Input
            value={grantorName}
            onChange={(e) => setGrantorName(e.target.value)}
          />
        </label>
        {needsProgram && (
          <label className="block">
            <Text size="small" className="mb-1">
              Designated program
            </Text>
            <Input
              value={designatedProgramId}
              onChange={(e) => setDesignatedProgramId(e.target.value)}
              placeholder="prog_meals"
            />
          </label>
        )}
        {needsWindow && (
          <>
            <label className="block">
              <Text size="small" className="mb-1">
                Spend from
              </Text>
              <Input
                type="date"
                value={spendFrom}
                onChange={(e) => setSpendFrom(e.target.value)}
              />
            </label>
            <label className="block">
              <Text size="small" className="mb-1">
                Spend until
              </Text>
              <Input
                type="date"
                value={spendUntil}
                onChange={(e) => setSpendUntil(e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      <Button onClick={submit} isLoading={create.isPending}>
        Open fund
      </Button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <DocumentText className="mx-auto mb-2 text-ui-fg-muted" />
      <Heading level="h3" className="text-base mb-1">
        No funds yet
      </Heading>
      <Text className="text-ui-fg-subtle">
        Open a fund for each grant or designated gift you hold, then record the
        award, what you receive against it, and what you spend.
      </Text>
    </div>
  )
}
