import { ArrowLeft, PencilSquare, Calendar, Plus, Trash, Tag, InformationCircle, LightBulb, CheckCircle } from "@medusajs/icons"
import {
  Container,
  Heading,
  Text,
  Button,
  Badge,
  Table,
  Tabs,
  usePrompt,
  toast,
  Tooltip,
} from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"
import { sdk } from "../../../../lib/sdk"
import {
  LotDTO,
  AvailabilityWindowDTO,
  LotGrade,
  LotGradeLabels,
  LotAllocationLabels,
  SalesChannelLabels,
  PricingStrategyLabels,
} from "../../../../types/domain"
import { LotProductLinking } from "./components/lot-product-linking"

// Help content for lot pages
const LOT_HELP = {
  utilization: "Percentage of inventory that's been sold or reserved",
  surplus: "Mark inventory that needs to move quickly. Enables special discounts or donation tracking.",
  availability: "Time windows when this lot is available for purchase through different sales channels"
}

const useLot = (id: string) => {
  return useQuery({
    queryKey: ["farm-lot", id],
    queryFn: async () => {
      const response = await sdk.client.fetch<{ lot: LotDTO }>(
        `/vendor/farm/lots/${id}`
      )
      return response.lot
    },
    enabled: !!id,
  })
}

const useDeleteLot = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await sdk.client.fetch(`/vendor/farm/lots/${id}`, {
        method: "DELETE",
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farm-lots"] })
      queryClient.invalidateQueries({ queryKey: ["farm-harvests"] })
    },
  })
}

const useMarkSurplus = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      await sdk.client.fetch(`/vendor/farm/lots/${id}/surplus`, {
        method: "POST",
        body: { reason },
      })
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["farm-lot", id] })
    },
  })
}

const getLotGradeBadgeColor = (grade: LotGrade) => {
  switch (grade) {
    case LotGrade.PREMIUM:
      return "purple"
    case LotGrade.GRADE_A:
      return "green"
    case LotGrade.GRADE_B:
      return "blue"
    case LotGrade.PROCESSING:
      return "orange"
    case LotGrade.IMPERFECT:
      return "grey"
    case LotGrade.SECONDS:
      return "grey"
    default:
      return "grey"
  }
}

const AvailabilityRow = ({ window: aw }: { window: AvailabilityWindowDTO }) => {
  const navigate = useNavigate()

  return (
    <Table.Row
      className="cursor-pointer"
      onClick={() => navigate(`/farm/availability/${aw.id}`)}
    >
      <Table.Cell>
        <Badge color="grey" size="small">
          {SalesChannelLabels[aw.sales_channel] || aw.sales_channel}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <Text size="small">
          ${aw.unit_price.toFixed(2)} / unit
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Badge color="grey" size="small">
          {PricingStrategyLabels[aw.pricing_strategy] || aw.pricing_strategy}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <Text size="small">
          {new Date(aw.available_from).toLocaleDateString()}
          {aw.available_until && (
            <> - {new Date(aw.available_until).toLocaleDateString()}</>
          )}
        </Text>
      </Table.Cell>
      <Table.Cell>
        {aw.is_active ? (
          <Badge color="green" size="small">Active</Badge>
        ) : aw.paused_at ? (
          <Badge color="orange" size="small">Paused</Badge>
        ) : (
          <Badge color="grey" size="small">Inactive</Badge>
        )}
      </Table.Cell>
    </Table.Row>
  )
}

const LotDetailPage = () => {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const { id } = useParams<{ id: string }>()
  const { data: lot, isLoading, isError } = useLot(id!)
  const deleteLot = useDeleteLot()
  const markSurplus = useMarkSurplus()

  const handleDelete = async () => {
    if (!lot) return

    const confirmed = await prompt({
      title: "Delete Lot",
      description: `Are you sure you want to delete lot "${lot.lot_number || lot.id}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
    })

    if (confirmed) {
      try {
        await deleteLot.mutateAsync(lot.id)
        toast.success("Lot deleted")
        navigate(`/farm/harvests/${lot.harvest_id}`)
      } catch {
        toast.error("Failed to delete lot")
      }
    }
  }

  const handleMarkSurplus = async () => {
    if (!lot) return

    const confirmed = await prompt({
      title: "Mark as Surplus",
      description: "This will flag this lot as surplus inventory, which can enable special pricing. Continue?",
      confirmText: "Mark Surplus",
      cancelText: "Cancel",
    })

    if (confirmed) {
      try {
        await markSurplus.mutateAsync({ id: lot.id, reason: "Excess inventory" })
        toast.success("Lot marked as surplus")
      } catch {
        toast.error("Failed to mark surplus")
      }
    }
  }

  if (isLoading) {
    return (
      <Container className="p-6">
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ui-fg-base"></div>
          <Text className="text-ui-fg-subtle">Loading lot details...</Text>
        </div>
      </Container>
    )
  }

  if (isError || !lot) {
    return (
      <Container className="p-6">
        <div className="flex flex-col items-center justify-center py-10 gap-4">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <Text className="text-red-600 text-xl">!</Text>
          </div>
          <Text className="text-ui-fg-error font-medium">Failed to load lot</Text>
          <Text className="text-ui-fg-subtle text-sm">The lot may have been deleted or you don't have access</Text>
          <Button variant="secondary" onClick={() => navigate("/farm/harvests")}>
            Back to Harvests
          </Button>
        </div>
      </Container>
    )
  }

  const availabilityWindows = lot.availability_windows || []
  const utilizationPercent = lot.quantity_total > 0
    ? Math.round(((lot.quantity_sold + lot.quantity_reserved) / lot.quantity_total) * 100)
    : 0

  return (
    <div className="flex flex-col gap-y-4">
      {/* Header */}
      <Container className="p-0">
        <div className="flex items-center gap-2 px-6 py-3 border-b">
          <Button
            variant="transparent"
            size="small"
            onClick={() => navigate(`/farm/harvests/${lot.harvest_id}`)}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Text className="text-ui-fg-subtle">Back to Harvest</Text>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <div className="flex items-center gap-2">
              <Heading level="h1">
                {lot.lot_number || `Lot ${lot.id.slice(-6)}`}
              </Heading>
              <Badge color={getLotGradeBadgeColor(lot.grade)} size="small">
                {LotGradeLabels[lot.grade]}
              </Badge>
              {lot.surplus_flag && (
                <Badge color="orange" size="small">Surplus</Badge>
              )}
              {!lot.is_active && (
                <Badge color="grey" size="small">Inactive</Badge>
              )}
            </div>
            <Text className="text-ui-fg-subtle mt-1">
              {LotAllocationLabels[lot.allocation_type] ?? lot.allocation_type}
              {lot.size_class && ` • ${lot.size_class}`}
              {lot.batch_date && ` • Batch ${new Date(lot.batch_date).toLocaleDateString()}`}
            </Text>
          </div>
          <div className="flex gap-2">
            {!lot.surplus_flag && (
              <Button variant="secondary" onClick={handleMarkSurplus}>
                <Tag className="mr-2" />
                Mark Surplus
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => navigate(`/farm/lots/${id}/availability/create`)}
            >
              <Plus className="mr-2" />
              Add Availability
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate(`/farm/lots/${id}/edit`)}
            >
              <PencilSquare className="mr-2" />
              Edit
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
            >
              <Trash className="mr-2" />
              Delete
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-4 p-6">
          <Tooltip content="Total quantity in this lot">
            <div className="flex flex-col cursor-help hover:bg-ui-bg-subtle p-2 rounded-lg transition-colors">
              <div className="flex items-center gap-1">
                <Text className="text-ui-fg-subtle text-sm">Total Quantity</Text>
                <InformationCircle className="w-3 h-3 text-ui-fg-muted" />
              </div>
              <Text className="text-xl font-semibold">
                {lot.quantity_total} {lot.unit}
              </Text>
            </div>
          </Tooltip>
          <Tooltip content="Quantity available for new orders">
            <div className="flex flex-col cursor-help hover:bg-ui-bg-subtle p-2 rounded-lg transition-colors">
              <div className="flex items-center gap-1">
                <Text className="text-ui-fg-subtle text-sm">Available</Text>
                <InformationCircle className="w-3 h-3 text-ui-fg-muted" />
              </div>
              <Text className="text-xl font-semibold text-green-600">
                {lot.quantity_available} {lot.unit}
              </Text>
              {lot.quantity_available === 0 && (
                <Text className="text-xs text-amber-600">Sold out</Text>
              )}
            </div>
          </Tooltip>
          <Tooltip content="Quantity held for pending orders">
            <div className="flex flex-col cursor-help hover:bg-ui-bg-subtle p-2 rounded-lg transition-colors">
              <div className="flex items-center gap-1">
                <Text className="text-ui-fg-subtle text-sm">Reserved</Text>
                <InformationCircle className="w-3 h-3 text-ui-fg-muted" />
              </div>
              <Text className="text-xl font-semibold text-blue-600">
                {lot.quantity_reserved} {lot.unit}
              </Text>
            </div>
          </Tooltip>
          <Tooltip content="Quantity already shipped or picked up">
            <div className="flex flex-col cursor-help hover:bg-ui-bg-subtle p-2 rounded-lg transition-colors">
              <div className="flex items-center gap-1">
                <Text className="text-ui-fg-subtle text-sm">Sold</Text>
                <InformationCircle className="w-3 h-3 text-ui-fg-muted" />
              </div>
              <Text className="text-xl font-semibold">
                {lot.quantity_sold} {lot.unit}
              </Text>
            </div>
          </Tooltip>
          <Tooltip content={LOT_HELP.utilization}>
            <div className="flex flex-col cursor-help hover:bg-ui-bg-subtle p-2 rounded-lg transition-colors">
              <div className="flex items-center gap-1">
                <Text className="text-ui-fg-subtle text-sm">Utilization</Text>
                <InformationCircle className="w-3 h-3 text-ui-fg-muted" />
              </div>
              <Text className="text-xl font-semibold">{utilizationPercent}%</Text>
              {/* Progress bar */}
              <div className="w-full bg-ui-bg-subtle rounded-full h-1.5 mt-1">
                <div 
                  className={`h-1.5 rounded-full transition-all ${
                    utilizationPercent > 75 ? "bg-green-500" : 
                    utilizationPercent > 25 ? "bg-blue-500" : "bg-gray-400"
                  }`}
                  style={{ width: `${utilizationPercent}%` }}
                />
              </div>
            </div>
          </Tooltip>
        </div>

        {/* Quick tip for new lots */}
        {lot.quantity_sold === 0 && availabilityWindows.length === 0 && (
          <div className="mx-6 mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-3">
              <LightBulb className="w-5 h-5 text-amber-600 mt-0.5" />
              <div>
                <Text className="font-medium text-amber-800">Ready to sell this lot?</Text>
                <Text className="text-amber-700 text-sm mt-1">
                  Link this lot to a product to make it available for purchase. 
                  Customers will be able to buy from your inventory.
                </Text>
              </div>
            </div>
          </div>
        )}
      </Container>

      {/* Product Linking */}
      <LotProductLinking 
        lotId={lot.id} 
        suggestedPrice={lot.suggested_price_per_unit || undefined}
        unit={lot.unit}
      />

      {/* Tabs */}
      <Container className="p-0">
        <Tabs defaultValue="availability">
          <Tabs.List className="px-6">
            <Tabs.Trigger value="availability">
              <Calendar className="w-4 h-4 mr-2" />
              Availability ({availabilityWindows.length})
            </Tabs.Trigger>
            <Tabs.Trigger value="details">Details</Tabs.Trigger>
            <Tabs.Trigger value="pricing">Pricing</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="availability" className="p-0">
            {availabilityWindows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-y-4">
                <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
                  <Calendar className="w-8 h-8 text-blue-600" />
                </div>
                <Heading level="h3">No availability windows yet</Heading>
                <Text className="text-ui-fg-subtle text-sm max-w-md text-center">
                  Availability windows define when and how this lot can be purchased.
                  Set different prices for different channels (retail, wholesale, CSA).
                </Text>
                
                {/* Example scenarios */}
                <div className="bg-ui-bg-subtle rounded-lg p-4 max-w-md w-full mt-2">
                  <Text className="font-medium text-sm mb-2">Example use cases:</Text>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                      <Text className="text-ui-fg-subtle">Farmers market special pricing this weekend</Text>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                      <Text className="text-ui-fg-subtle">Wholesale discount for restaurant buyers</Text>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                      <Text className="text-ui-fg-subtle">CSA member exclusive early access</Text>
                    </div>
                  </div>
                </div>

                <Button
                  variant="secondary"
                  onClick={() => navigate(`/farm/lots/${id}/availability/create`)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Availability Window
                </Button>
              </div>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Channel</Table.HeaderCell>
                    <Table.HeaderCell>Price</Table.HeaderCell>
                    <Table.HeaderCell>Strategy</Table.HeaderCell>
                    <Table.HeaderCell>Dates</Table.HeaderCell>
                    <Table.HeaderCell>Status</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {availabilityWindows.map((aw) => (
                    <AvailabilityRow key={aw.id} window={aw} />
                  ))}
                </Table.Body>
              </Table>
            )}
          </Tabs.Content>

          <Tabs.Content value="details" className="p-6">
            <div className="grid grid-cols-2 gap-6">
              {lot.external_lot_id && (
                <div className="p-4 bg-ui-bg-subtle rounded-lg">
                  <Text className="text-ui-fg-subtle text-sm">External Lot ID</Text>
                  <Text className="font-medium">{lot.external_lot_id}</Text>
                  <Text className="text-ui-fg-muted text-xs mt-1">For syncing with other systems</Text>
                </div>
              )}
              {lot.storage_location && (
                <div className="p-4 bg-ui-bg-subtle rounded-lg">
                  <Text className="text-ui-fg-subtle text-sm">Storage Location</Text>
                  <Text className="font-medium">{lot.storage_location}</Text>
                </div>
              )}
              {lot.storage_requirements && (
                <div className="p-4 bg-ui-bg-subtle rounded-lg">
                  <Text className="text-ui-fg-subtle text-sm">Storage Requirements</Text>
                  <Text className="font-medium">{lot.storage_requirements}</Text>
                </div>
              )}
              {lot.best_by_date && (
                <div className="p-4 bg-ui-bg-subtle rounded-lg">
                  <Text className="text-ui-fg-subtle text-sm">Best By Date</Text>
                  <Text className="font-medium">{new Date(lot.best_by_date).toLocaleDateString()}</Text>
                  <Text className="text-ui-fg-muted text-xs mt-1">Optimal freshness date</Text>
                </div>
              )}
              {lot.use_by_date && (
                <div className="p-4 bg-ui-bg-subtle rounded-lg">
                  <Text className="text-ui-fg-subtle text-sm">Use By Date</Text>
                  <Text className="font-medium">{new Date(lot.use_by_date).toLocaleDateString()}</Text>
                  <Text className="text-ui-fg-muted text-xs mt-1">Final sale deadline</Text>
                </div>
              )}
              {lot.surplus_flag && lot.surplus_reason && (
                <div className="col-span-2 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Tag className="w-4 h-4 text-orange-600" />
                    <Text className="font-medium text-orange-800">Surplus Reason</Text>
                  </div>
                  <Text className="text-orange-700">{lot.surplus_reason}</Text>
                </div>
              )}
              
              {/* Empty state if no details */}
              {!lot.external_lot_id && !lot.storage_location && !lot.storage_requirements && 
               !lot.best_by_date && !lot.use_by_date && !lot.surplus_flag && (
                <div className="col-span-2 flex flex-col items-center justify-center py-8 text-center">
                  <Text className="text-ui-fg-subtle">No additional details set</Text>
                  <Text className="text-ui-fg-muted text-sm mt-1">
                    Edit this lot to add storage location, dates, or other information
                  </Text>
                  <Button 
                    variant="secondary" 
                    size="small"
                    className="mt-3"
                    onClick={() => navigate(`/farm/lots/${id}/edit`)}
                  >
                    Add Details
                  </Button>
                </div>
              )}
            </div>
          </Tabs.Content>

          <Tabs.Content value="pricing" className="p-6">
            <div className="grid grid-cols-3 gap-6">
              <div className="p-4 bg-ui-bg-subtle rounded-lg">
                <Text className="text-ui-fg-subtle text-sm">Suggested Price</Text>
                <Text className="text-2xl font-semibold mt-1">
                  {lot.suggested_price_per_unit
                    ? `$${lot.suggested_price_per_unit.toFixed(2)}`
                    : "—"}
                </Text>
                {lot.unit && <Text className="text-ui-fg-muted text-sm">per {lot.unit}</Text>}
                <Text className="text-ui-fg-muted text-xs mt-2">
                  Recommended retail price
                </Text>
              </div>
              <div className="p-4 bg-ui-bg-subtle rounded-lg">
                <Text className="text-ui-fg-subtle text-sm">Cost (Internal)</Text>
                <Text className="text-2xl font-semibold mt-1">
                  {lot.cost_per_unit
                    ? `$${lot.cost_per_unit.toFixed(2)}`
                    : "—"}
                </Text>
                {lot.unit && <Text className="text-ui-fg-muted text-sm">per {lot.unit}</Text>}
                <Text className="text-ui-fg-muted text-xs mt-2">
                  Your production cost
                </Text>
              </div>
              {lot.suggested_price_per_unit && lot.cost_per_unit && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <Text className="text-green-700 text-sm">Profit Margin</Text>
                  <Text className="text-2xl font-semibold text-green-700 mt-1">
                    {Math.round(
                      ((lot.suggested_price_per_unit - lot.cost_per_unit) /
                        lot.suggested_price_per_unit) *
                        100
                    )}%
                  </Text>
                  <Text className="text-green-600 text-xs mt-2">
                    ${(lot.suggested_price_per_unit - lot.cost_per_unit).toFixed(2)} profit per {lot.unit}
                  </Text>
                </div>
              )}
            </div>
            
            {/* Pricing tip */}
            {!lot.suggested_price_per_unit && (
              <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <LightBulb className="w-5 h-5 text-amber-600 mt-0.5" />
                  <div>
                    <Text className="font-medium text-amber-800">Set a suggested price</Text>
                    <Text className="text-amber-700 text-sm mt-1">
                      Adding a suggested price helps when creating availability windows 
                      and linking to products. Edit this lot to set pricing.
                    </Text>
                  </div>
                </div>
              </div>
            )}
          </Tabs.Content>
        </Tabs>
      </Container>
    </div>
  )
}

export default LotDetailPage
