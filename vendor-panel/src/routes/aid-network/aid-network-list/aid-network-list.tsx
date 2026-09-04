import { useMemo, useState } from "react"
import { Outlet } from "react-router-dom"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Select,
  Switch,
  Tabs,
  Text,
  toast,
} from "@medusajs/ui"
import { Buildings, MapPin, Clock } from "@medusajs/icons"
import { SingleColumnPage } from "../../../components/layout/pages"
import { useDashboardExtension } from "../../../extensions"
import {
  useCreateNetworkNode,
  useNetworkNodes,
  useNodeTransfers,
  usePlanAllocation,
  useReceiveTransfer,
  useRecordIntake,
  useRequestTransfer,
  useSurplus,
} from "../../../hooks/api/aid-network"

const NODE_TYPES = [
  "pantry",
  "free_store",
  "kitchen",
  "garden",
  "warehouse",
  "distribution_point",
  "popup",
]

const INTAKE_SOURCES = [
  { value: "donation", label: "Donation" },
  { value: "rescue", label: "Rescue — recovered before discard" },
  { value: "gleaning", label: "Gleaning — gathered post-harvest" },
  { value: "overproduction", label: "Overproduction" },
]

/** Why a demand could not be filled, in words an operator can act on. */
const UNMET_REASONS: Record<string, string> = {
  no_supply: "Nothing in the network to send",
  cold_chain_unavailable: "Destination has no cold storage",
  expires_before_needed: "Available stock spoils before it is needed",
  out_of_range: "Only available beyond the distance limit",
  transfers_disabled: "Holding hub does not release stock",
}

interface NodeRow {
  id: string
  name: string
  slug: string
  node_type: string
  city?: string | null
  state?: string | null
  has_cold_storage?: boolean
  accepts_intake?: boolean
  accepts_transfers?: boolean
  status?: string
}

export function AidNetworkList() {
  const { getWidgets } = useDashboardExtension()
  const [tab, setTab] = useState("hubs")

  const { data: nodesData, isLoading } = useNetworkNodes()
  const nodes: NodeRow[] = useMemo(
    () => nodesData?.network_nodes ?? [],
    [nodesData]
  )

  return (
    <SingleColumnPage
      widgets={{
        before: getWidgets("aid_network.list.before"),
        after: getWidgets("aid_network.list.after"),
      }}
    >
      <Container className="p-8 space-y-6">
        <div>
          <Heading level="h1" className="text-2xl">
            Aid Network
          </Heading>
          <Text className="text-ui-fg-subtle mt-1">
            Your hubs, what each holds, what arrives without a purchase order,
            and what should move before it spoils.
          </Text>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <Tabs.List>
            <Tabs.Trigger value="hubs">Hubs</Tabs.Trigger>
            <Tabs.Trigger value="intake">Intake</Tabs.Trigger>
            <Tabs.Trigger value="surplus">Surplus</Tabs.Trigger>
            <Tabs.Trigger value="planner">Planner</Tabs.Trigger>
            <Tabs.Trigger value="transfers">Transfers</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="hubs" className="mt-6">
            <HubsTab nodes={nodes} isLoading={isLoading} />
          </Tabs.Content>
          <Tabs.Content value="intake" className="mt-6">
            <IntakeTab nodes={nodes} />
          </Tabs.Content>
          <Tabs.Content value="surplus" className="mt-6">
            <SurplusTab nodes={nodes} />
          </Tabs.Content>
          <Tabs.Content value="planner" className="mt-6">
            <PlannerTab nodes={nodes} />
          </Tabs.Content>
          <Tabs.Content value="transfers" className="mt-6">
            <TransfersTab nodes={nodes} />
          </Tabs.Content>
        </Tabs>
      </Container>
      <Outlet />
    </SingleColumnPage>
  )
}

function nodeName(nodes: NodeRow[], id: string): string {
  return nodes.find((n) => n.id === id)?.name ?? id
}

function HubsTab({
  nodes,
  isLoading,
}: {
  nodes: NodeRow[]
  isLoading: boolean
}) {
  const create = useCreateNetworkNode()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [nodeType, setNodeType] = useState("pantry")
  const [city, setCity] = useState("")
  const [latitude, setLatitude] = useState("")
  const [longitude, setLongitude] = useState("")
  const [hasCold, setHasCold] = useState(false)

  const submit = () => {
    if (!name || !slug) {
      toast.error("Name and slug are required")
      return
    }
    // Half a coordinate is rejected by the backend; catch it here too so the
    // operator sees which field is missing rather than a generic 400.
    const hasLat = latitude.trim() !== ""
    const hasLon = longitude.trim() !== ""
    if (hasLat !== hasLon) {
      toast.error("Give both latitude and longitude, or neither")
      return
    }

    create.mutate(
      {
        name,
        slug,
        node_type: nodeType,
        city: city || undefined,
        latitude: hasLat ? Number(latitude) : undefined,
        longitude: hasLon ? Number(longitude) : undefined,
        has_cold_storage: hasCold,
      },
      {
        onSuccess: () => {
          toast.success("Hub added")
          setOpen(false)
          setName("")
          setSlug("")
        },
        onError: (error: Error) => toast.error(error.message),
      }
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Add a hub"}
        </Button>
      </div>

      {open && (
        <div className="rounded-xl border p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Slug">
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="north-pantry"
              />
            </Field>
            <Field label="Type">
              <Select value={nodeType} onValueChange={setNodeType}>
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {NODE_TYPES.map((t) => (
                    <Select.Item key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </Field>
            <Field label="City">
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label="Latitude" hint="Used to pick the nearest hub">
              <Input
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
              />
            </Field>
            <Field label="Longitude">
              <Input
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded border p-3">
            <div>
              <Text size="small">Has cold storage</Text>
              <Text size="xsmall" className="text-ui-fg-muted">
                Cold items are never routed to a hub that cannot hold them.
              </Text>
            </div>
            <Switch checked={hasCold} onCheckedChange={setHasCold} />
          </div>
          <Button onClick={submit} isLoading={create.isPending}>
            Add hub
          </Button>
        </div>
      )}

      {isLoading ? (
        <Text className="text-ui-fg-subtle">Loading hubs…</Text>
      ) : nodes.length === 0 ? (
        <Empty
          icon={<Buildings className="mx-auto mb-2 text-ui-fg-muted" />}
          title="No hubs yet"
          body="Add each place that holds stock — a pantry, free store, kitchen or warehouse. Allocation needs at least two to move anything between them."
        />
      ) : (
        <div className="space-y-2">
          {nodes.map((n) => (
            <div
              key={n.id}
              className="rounded-lg border p-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Text weight="plus">{n.name}</Text>
                  <Badge size="2xsmall">{n.node_type.replace(/_/g, " ")}</Badge>
                </div>
                <Text size="small" className="text-ui-fg-subtle">
                  {[n.city, n.state].filter(Boolean).join(", ") || "No address"}
                </Text>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {n.has_cold_storage && <Badge color="blue">Cold storage</Badge>}
                {n.accepts_intake === false && <Badge color="grey">No intake</Badge>}
                {n.accepts_transfers === false && (
                  <Badge color="orange">Holds stock</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function IntakeTab({ nodes }: { nodes: NodeRow[] }) {
  const record = useRecordIntake()
  const intakeNodes = nodes.filter((n) => n.accepts_intake !== false)

  const [nodeId, setNodeId] = useState("")
  const [source, setSource] = useState("donation")
  const [donorName, setDonorName] = useState("")
  const [value, setValue] = useState("")
  const [basis, setBasis] = useState("")
  const [itemKey, setItemKey] = useState("")
  const [itemLabel, setItemLabel] = useState("")
  const [quantity, setQuantity] = useState("")
  const [unit, setUnit] = useState("each")
  const [expiresAt, setExpiresAt] = useState("")
  const [requiresCold, setRequiresCold] = useState(false)

  const submit = () => {
    if (!nodeId) return toast.error("Pick the hub that received it")
    if (!itemKey || !itemLabel) return toast.error("Item key and label are required")
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) return toast.error("Enter a quantity")

    record.mutate(
      {
        node_id: nodeId,
        source,
        donor_name: donorName || undefined,
        estimated_value_cents: value ? Math.round(Number(value) * 100) : undefined,
        valuation_basis: basis || undefined,
        lines: [
          {
            item_key: itemKey,
            item_label: itemLabel,
            quantity: qty,
            unit_of_measure: unit,
            expires_at: expiresAt || undefined,
            requires_cold: requiresCold,
          },
        ],
      },
      {
        onSuccess: () => {
          toast.success("Intake recorded and stock created")
          setItemKey("")
          setItemLabel("")
          setQuantity("")
          setExpiresAt("")
        },
        onError: (error: Error) => toast.error(error.message),
      }
    )
  }

  if (intakeNodes.length === 0) {
    return (
      <Empty
        icon={<Buildings className="mx-auto mb-2 text-ui-fg-muted" />}
        title="No hub can receive intake"
        body="Add a hub with intake enabled before recording donated or rescued goods."
      />
    )
  }

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div>
        <Heading level="h3" className="text-base">
          Record what arrived
        </Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Goods with no purchase order behind them. Recording this creates the
          stock, so it becomes allocatable immediately.
        </Text>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Hub">
          <Select value={nodeId} onValueChange={setNodeId}>
            <Select.Trigger>
              <Select.Value placeholder="Select a hub" />
            </Select.Trigger>
            <Select.Content>
              {intakeNodes.map((n) => (
                <Select.Item key={n.id} value={n.id}>
                  {n.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Source">
          <Select value={source} onValueChange={setSource}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {INTAKE_SOURCES.map((s) => (
                <Select.Item key={s.value} value={s.value}>
                  {s.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Donor">
          <Input value={donorName} onChange={(e) => setDonorName(e.target.value)} />
        </Field>
        <Field
          label="Estimated value (USD)"
          hint="For acknowledgment and in-kind reporting"
        >
          <Input
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <Field label="Valuation basis" hint="How the figure was reached">
          <Input
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="USDA wholesale, week of…"
          />
        </Field>
      </div>

      <div className="rounded-lg border p-3 space-y-3">
        <Text size="small" weight="plus">
          What arrived
        </Text>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Item key" hint="Shared across hubs so stock can match">
            <Input
              value={itemKey}
              onChange={(e) => setItemKey(e.target.value)}
              placeholder="produce.carrots"
            />
          </Field>
          <Field label="Label">
            <Input
              value={itemLabel}
              onChange={(e) => setItemLabel(e.target.value)}
              placeholder="Carrots"
            />
          </Field>
          <Field label="Quantity">
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field label="Unit">
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
          <Field label="Expires" hint="Drives which stock moves first">
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded border p-3">
          <Text size="small">Needs cold storage</Text>
          <Switch checked={requiresCold} onCheckedChange={setRequiresCold} />
        </div>
      </div>

      <Button onClick={submit} isLoading={record.isPending}>
        Record intake
      </Button>
    </div>
  )
}

function SurplusTab({ nodes }: { nodes: NodeRow[] }) {
  const [withinDays, setWithinDays] = useState(3)
  const { data, isLoading } = useSurplus(withinDays)
  const surplus = data?.surplus ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Text size="small">Spoiling within</Text>
        <Select
          value={String(withinDays)}
          onValueChange={(v) => setWithinDays(Number(v))}
        >
          <Select.Trigger className="w-32">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {[1, 3, 7, 14].map((d) => (
              <Select.Item key={d} value={String(d)}>
                {d} day{d === 1 ? "" : "s"}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>

      {isLoading ? (
        <Text className="text-ui-fg-subtle">Loading…</Text>
      ) : surplus.length === 0 ? (
        <Empty
          icon={<Clock className="mx-auto mb-2 text-ui-fg-muted" />}
          title="Nothing spoiling in this window"
          body="Uncommitted stock nearing its expiry date shows here, soonest first, so it can be moved before it is wasted."
        />
      ) : (
        <div className="space-y-2">
          {surplus.map((s: Record<string, unknown>) => (
            <div
              key={String(s.stock_id)}
              className="rounded-lg border p-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <Text weight="plus">{String(s.item_key)}</Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {String(s.quantity)} at {nodeName(nodes, String(s.node_id))}
                </Text>
              </div>
              <Badge color={Number(s.days_remaining) <= 1 ? "red" : "orange"}>
                {Number(s.days_remaining).toFixed(1)} days left
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PlannerTab({ nodes }: { nodes: NodeRow[] }) {
  const plan = usePlanAllocation()
  const requestTransfer = useRequestTransfer()

  const [nodeId, setNodeId] = useState("")
  const [itemKey, setItemKey] = useState("")
  const [quantity, setQuantity] = useState("")
  const [neededBy, setNeededBy] = useState("")
  const [strategy, setStrategy] = useState("local_first")
  const [maxDistance, setMaxDistance] = useState("")

  const result = plan.data?.plan

  const run = () => {
    if (!nodeId) return toast.error("Pick the hub that needs stock")
    if (!itemKey) return toast.error("Item key is required")
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) return toast.error("Enter a quantity")

    plan.mutate(
      {
        demands: [
          {
            demand_id: `${nodeId}:${itemKey}`,
            node_id: nodeId,
            item_key: itemKey,
            quantity: qty,
            needed_by: neededBy || undefined,
          },
        ],
        strategy,
        max_distance_km: maxDistance ? Number(maxDistance) : undefined,
      },
      { onError: (error: Error) => toast.error(error.message) }
    )
  }

  const openTransfer = (line: Record<string, unknown>) => {
    requestTransfer.mutate(
      {
        from_node_id: String(line.from_node_id),
        to_node_id: String(line.to_node_id),
        item_key: String(line.item_key),
        item_label: String(line.item_key),
        requested_qty: Number(line.quantity),
        source_stock_id: String(line.stock_id),
        reason: "rebalance",
      },
      {
        onSuccess: () => toast.success("Transfer opened"),
        onError: (error: Error) => toast.error(error.message),
      }
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4 space-y-3">
        <div>
          <Heading level="h3" className="text-base">
            Plan an allocation
          </Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Suggestions only — nothing moves until you open a transfer below.
          </Text>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Hub that needs stock">
            <Select value={nodeId} onValueChange={setNodeId}>
              <Select.Trigger>
                <Select.Value placeholder="Select a hub" />
              </Select.Trigger>
              <Select.Content>
                {nodes.map((n) => (
                  <Select.Item key={n.id} value={n.id}>
                    {n.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </Field>
          <Field label="Item key">
            <Input
              value={itemKey}
              onChange={(e) => setItemKey(e.target.value)}
              placeholder="produce.carrots"
            />
          </Field>
          <Field label="Quantity">
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field label="Needed by">
            <Input
              type="date"
              value={neededBy}
              onChange={(e) => setNeededBy(e.target.value)}
            />
          </Field>
          <Field
            label="Strategy"
            hint="Local first avoids a transfer; expiry first wastes less"
          >
            <Select value={strategy} onValueChange={setStrategy}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="local_first">Local shelves first</Select.Item>
                <Select.Item value="expiry_first">
                  Soonest expiry first
                </Select.Item>
              </Select.Content>
            </Select>
          </Field>
          <Field label="Max distance (km)">
            <Input
              type="number"
              value={maxDistance}
              onChange={(e) => setMaxDistance(e.target.value)}
            />
          </Field>
        </div>
        <Button onClick={run} isLoading={plan.isPending}>
          Run plan
        </Button>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Heading level="h3" className="text-base">
              Suggested moves
            </Heading>
            {result.allocations.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                Nothing can be allocated for this demand.
              </Text>
            ) : (
              result.allocations.map((a: Record<string, unknown>, i: number) => (
                <div
                  key={`${String(a.stock_id)}-${i}`}
                  className="rounded-lg border p-4 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <Text weight="plus">
                      {String(a.quantity)} × {String(a.item_key)}
                    </Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      {a.is_local ? (
                        <>Already at {nodeName(nodes, String(a.to_node_id))} — no move needed</>
                      ) : (
                        <>
                          {nodeName(nodes, String(a.from_node_id))} →{" "}
                          {nodeName(nodes, String(a.to_node_id))}
                          {a.distance_km !== null &&
                            ` · ${Number(a.distance_km).toFixed(1)} km`}
                        </>
                      )}
                      {a.expires_at
                        ? ` · expires ${String(a.expires_at).slice(0, 10)}`
                        : ""}
                    </Text>
                  </div>
                  {a.is_local ? (
                    <Badge color="green">Local</Badge>
                  ) : (
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => openTransfer(a)}
                      isLoading={requestTransfer.isPending}
                    >
                      Open transfer
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>

          {result.unmet.length > 0 && (
            <div className="space-y-2">
              <Heading level="h3" className="text-base">
                Could not fill
              </Heading>
              {result.unmet.map((u: Record<string, unknown>, i: number) => (
                <div key={i} className="rounded-lg border p-4">
                  <Text weight="plus">
                    {String(u.quantity)} × {String(u.item_key)} at{" "}
                    {nodeName(nodes, String(u.node_id))}
                  </Text>
                  <Text size="small" className="text-ui-fg-subtle">
                    {UNMET_REASONS[String(u.reason)] ?? String(u.reason)}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TransfersTab({ nodes }: { nodes: NodeRow[] }) {
  const { data, isLoading } = useNodeTransfers()
  const receive = useReceiveTransfer()
  const [receiving, setReceiving] = useState<string | null>(null)
  const [receivedQty, setReceivedQty] = useState("")

  const transfers = data?.node_transfers ?? []

  const submitReceive = (transferId: string) => {
    const qty = Number(receivedQty)
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error("Enter what actually arrived")
      return
    }
    receive.mutate(
      { transferId, received_qty: qty },
      {
        onSuccess: () => {
          toast.success("Transfer received")
          setReceiving(null)
          setReceivedQty("")
        },
        onError: (error: Error) => toast.error(error.message),
      }
    )
  }

  if (isLoading) return <Text className="text-ui-fg-subtle">Loading…</Text>

  if (transfers.length === 0) {
    return (
      <Empty
        icon={<MapPin className="mx-auto mb-2 text-ui-fg-muted" />}
        title="No transfers yet"
        body="Transfers opened from the planner, or for rescue and surplus routing, appear here until they are received."
      />
    )
  }

  return (
    <div className="space-y-2">
      {transfers.map((t: Record<string, unknown>) => {
        const id = String(t.id)
        const isReceived = t.status === "received"
        return (
          <div key={id} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Text weight="plus">
                  {String(t.requested_qty)} × {String(t.item_label)}
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {nodeName(nodes, String(t.from_node_id))} →{" "}
                  {nodeName(nodes, String(t.to_node_id))} ·{" "}
                  {String(t.reason).replace(/_/g, " ")}
                </Text>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {Boolean(t.requires_cold) && <Badge color="blue">Cold</Badge>}
                <Badge color={isReceived ? "green" : "orange"}>
                  {String(t.status).replace(/_/g, " ")}
                </Badge>
              </div>
            </div>

            {isReceived && t.received_qty !== null && (
              <Text size="small" className="text-ui-fg-subtle">
                Received {String(t.received_qty)} of {String(t.requested_qty)}
                {Number(t.received_qty) < Number(t.requested_qty) && (
                  <span className="text-ui-fg-error">
                    {" "}
                    · {Number(t.requested_qty) - Number(t.received_qty)} lost in
                    transit
                  </span>
                )}
              </Text>
            )}

            {!isReceived && t.status !== "cancelled" && (
              <div>
                {receiving === id ? (
                  <div className="flex items-end gap-2">
                    <Field label="What actually arrived">
                      <Input
                        type="number"
                        value={receivedQty}
                        onChange={(e) => setReceivedQty(e.target.value)}
                      />
                    </Field>
                    <Button
                      size="small"
                      onClick={() => submitReceive(id)}
                      isLoading={receive.isPending}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => setReceiving(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      setReceiving(id)
                      setReceivedQty(String(t.requested_qty ?? ""))
                    }}
                  >
                    Receive
                  </Button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <Text size="small" className="mb-1">
        {label}
      </Text>
      {children}
      {hint && (
        <Text size="xsmall" className="text-ui-fg-muted mt-1">
          {hint}
        </Text>
      )}
    </label>
  )
}

function Empty({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      {icon}
      <Heading level="h3" className="text-base mb-1">
        {title}
      </Heading>
      <Text className="text-ui-fg-subtle">{body}</Text>
    </div>
  )
}
