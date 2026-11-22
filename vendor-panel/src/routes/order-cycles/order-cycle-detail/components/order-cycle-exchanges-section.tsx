import { useState } from "react"
import {
  Container,
  Heading,
  Text,
  Table,
  Button,
  Badge,
  Input,
  toast,
  usePrompt,
  IconButton,
  FocusModal,
  Label,
  Select,
  Tabs,
} from "@medusajs/ui"
import { PlusMini, Trash, Buildings, ArrowDownTray, ArrowUpTray } from "@medusajs/icons"
import {
  OrderCycle,
  OrderCycleExchange,
  useOrderCycleExchanges,
  useCreateExchange,
  useDeleteExchange,
  useAddProductsToExchange,
} from "../../../../hooks/api/order-cycles"
import { useProducts } from "../../../../hooks/api/products"
import { useMe } from "../../../../hooks/api/users"

interface OrderCycleExchangesSectionProps {
  orderCycle: OrderCycle
}

export const OrderCycleExchangesSection = ({
  orderCycle,
}: OrderCycleExchangesSectionProps) => {
  const [showAddModal, setShowAddModal] = useState(false)
  const [exchangeType, setExchangeType] = useState<"incoming" | "outgoing">("incoming")
  const { data: exchangesData, isLoading } = useOrderCycleExchanges(orderCycle.id)

  const incomingExchanges = exchangesData?.incoming || []
  const outgoingExchanges = exchangesData?.outgoing || []

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Supply Chain</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage incoming products from producers and outgoing distribution
            </Text>
          </div>
          <Button variant="secondary" onClick={() => setShowAddModal(true)}>
            <PlusMini />
            Add Exchange
          </Button>
        </div>

        <Tabs defaultValue="incoming" className="w-full">
          <div className="px-6 pt-4">
            <Tabs.List>
              <Tabs.Trigger value="incoming" className="flex items-center gap-2">
                <ArrowDownTray className="w-4 h-4" />
                Incoming ({incomingExchanges.length})
              </Tabs.Trigger>
              <Tabs.Trigger value="outgoing" className="flex items-center gap-2">
                <ArrowUpTray className="w-4 h-4" />
                Outgoing ({outgoingExchanges.length})
              </Tabs.Trigger>
            </Tabs.List>
          </div>

          <Tabs.Content value="incoming" className="pt-4">
            <ExchangeList
              exchanges={incomingExchanges}
              type="incoming"
              orderCycleId={orderCycle.id}
              isLoading={isLoading}
              onAddClick={() => {
                setExchangeType("incoming")
                setShowAddModal(true)
              }}
            />
          </Tabs.Content>

          <Tabs.Content value="outgoing" className="pt-4">
            <ExchangeList
              exchanges={outgoingExchanges}
              type="outgoing"
              orderCycleId={orderCycle.id}
              isLoading={isLoading}
              onAddClick={() => {
                setExchangeType("outgoing")
                setShowAddModal(true)
              }}
            />
          </Tabs.Content>
        </Tabs>
      </Container>

      <AddExchangeModal
        orderCycleId={orderCycle.id}
        defaultType={exchangeType}
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
      />
    </>
  )
}

interface ExchangeListProps {
  exchanges: OrderCycleExchange[]
  type: "incoming" | "outgoing"
  orderCycleId: string
  isLoading: boolean
  onAddClick: () => void
}

const ExchangeList = ({
  exchanges,
  type,
  orderCycleId,
  isLoading,
  onAddClick,
}: ExchangeListProps) => {
  const deleteExchange = useDeleteExchange(orderCycleId)
  const prompt = usePrompt()
  const [expandedExchange, setExpandedExchange] = useState<string | null>(null)

  const handleDelete = async (exchange: OrderCycleExchange) => {
    const confirmed = await prompt({
      title: "Remove Exchange",
      description: `Are you sure you want to remove this ${type} exchange?`,
      confirmText: "Remove",
      cancelText: "Cancel",
    })

    if (confirmed) {
      try {
        await deleteExchange.mutateAsync(exchange.id)
        toast.success("Exchange removed")
      } catch (err) {
        toast.error("Failed to remove exchange")
      }
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Text className="text-ui-fg-subtle">Loading...</Text>
      </div>
    )
  }

  if (exchanges.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-ui-bg-subtle">
          {type === "incoming" ? (
            <ArrowDownTray className="w-6 h-6 text-ui-fg-subtle" />
          ) : (
            <ArrowUpTray className="w-6 h-6 text-ui-fg-subtle" />
          )}
        </div>
        <Text className="text-ui-fg-subtle">
          {type === "incoming"
            ? "No incoming exchanges yet. Add producers to receive products from."
            : "No outgoing exchanges yet. Add distributors to send products to."}
        </Text>
        <Button variant="secondary" onClick={onAddClick}>
          Add {type === "incoming" ? "Producer" : "Distributor"}
        </Button>
      </div>
    )
  }

  return (
    <div className="divide-y">
      {exchanges.map((exchange) => (
        <div key={exchange.id} className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-ui-bg-subtle">
                <Buildings className="w-5 h-5 text-ui-fg-subtle" />
              </div>
              <div>
                <Text weight="plus">
                  {exchange.seller?.name || `Seller ${exchange.seller_id.slice(0, 8)}...`}
                </Text>
                <div className="flex items-center gap-2">
                  <Badge color={exchange.is_active ? "green" : "grey"} size="small">
                    {exchange.is_active ? "Active" : "Inactive"}
                  </Badge>
                  {exchange.pickup_time && (
                    <Text size="small" className="text-ui-fg-subtle">
                      Pickup: {exchange.pickup_time}
                    </Text>
                  )}
                  {exchange.ready_at && (
                    <Text size="small" className="text-ui-fg-subtle">
                      Ready: {new Date(exchange.ready_at).toLocaleDateString()}
                    </Text>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  setExpandedExchange(
                    expandedExchange === exchange.id ? null : exchange.id
                  )
                }
              >
                {expandedExchange === exchange.id ? "Hide" : "Manage"} Products
              </Button>
              <IconButton variant="transparent" onClick={() => handleDelete(exchange)}>
                <Trash className="text-ui-fg-error" />
              </IconButton>
            </div>
          </div>

          {expandedExchange === exchange.id && (
            <div className="mt-4 pl-13">
              <ExchangeProducts
                exchange={exchange}
                orderCycleId={orderCycleId}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

interface ExchangeProductsProps {
  exchange: OrderCycleExchange
  orderCycleId: string
}

/**
 * One exchange's products. Only the exchange's own store can add products to
 * it: the backend writes a store's own variants onto its own exchange and
 * answers 403 to anyone else, the cycle's coordinator included (SD-158), so
 * the button is not offered on another store's exchange, nor before the
 * viewer's store is known.
 */
export const ExchangeProducts = ({ exchange, orderCycleId }: ExchangeProductsProps) => {
  const [showAddProducts, setShowAddProducts] = useState(false)
  const { seller } = useMe()
  const canAddProducts = !!seller?.id && seller.id === exchange.seller_id
  const products = exchange.products || []

  return (
    <div className="border rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 bg-ui-bg-subtle border-b">
        <Text size="small" weight="plus">
          Products ({products.length})
        </Text>
        {canAddProducts && (
          <Button variant="secondary" size="small" onClick={() => setShowAddProducts(true)}>
            <PlusMini />
            Add Products
          </Button>
        )}
      </div>

      {products.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <Text size="small" className="text-ui-fg-subtle">
            No products in this exchange yet
          </Text>
        </div>
      ) : (
        <Table>
          <Table.Body>
            {products.map((product) => (
              <Table.Row key={product.id}>
                <Table.Cell>
                  <div className="flex items-center gap-2">
                    {product.variant?.product?.thumbnail && (
                      <img
                        src={product.variant.product.thumbnail}
                        alt=""
                        className="h-8 w-8 rounded object-cover"
                      />
                    )}
                    <div>
                      <Text size="small" weight="plus">
                        {product.variant?.product?.title || "Unknown"}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {product.variant?.title}
                      </Text>
                    </div>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small">
                    {product.available_quantity ?? "Unlimited"}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {canAddProducts && (
        <AddProductsToExchangeModal
          exchangeId={exchange.id}
          orderCycleId={orderCycleId}
          sellerId={exchange.seller_id}
          existingVariantIds={products.map((p) => p.variant_id)}
          open={showAddProducts}
          onClose={() => setShowAddProducts(false)}
        />
      )}
    </div>
  )
}

interface AddExchangeModalProps {
  orderCycleId: string
  defaultType: "incoming" | "outgoing"
  open: boolean
  onClose: () => void
}

const AddExchangeModal = ({
  orderCycleId,
  defaultType,
  open,
  onClose,
}: AddExchangeModalProps) => {
  const [exchangeType, setExchangeType] = useState<"incoming" | "outgoing">(defaultType)
  const [sellerId, setSellerId] = useState("")
  const [pickupTime, setPickupTime] = useState("")
  const [pickupInstructions, setPickupInstructions] = useState("")

  const createExchange = useCreateExchange(orderCycleId)

  // Reset form when modal opens
  useState(() => {
    setExchangeType(defaultType)
  })

  const handleSubmit = async () => {
    if (!sellerId) {
      toast.error("Please enter a seller ID")
      return
    }

    try {
      await createExchange.mutateAsync({
        exchange_type: exchangeType,
        seller_id: sellerId,
        pickup_time: pickupTime || undefined,
        pickup_instructions: pickupInstructions || undefined,
      })
      toast.success(`${exchangeType === "incoming" ? "Producer" : "Distributor"} added`)
      onClose()
      setSellerId("")
      setPickupTime("")
      setPickupInstructions("")
    } catch (err) {
      toast.error("Failed to create exchange")
    }
  }

  return (
    <FocusModal open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} isLoading={createExchange.isPending}>
            Add {exchangeType === "incoming" ? "Producer" : "Distributor"}
          </Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-16">
          <div className="flex w-full max-w-lg flex-col gap-y-8">
            <div>
              <Heading>
                Add {exchangeType === "incoming" ? "Incoming" : "Outgoing"} Exchange
              </Heading>
              <Text className="text-ui-fg-subtle">
                {exchangeType === "incoming"
                  ? "Add a producer to receive products from"
                  : "Add a distributor to send products to"}
              </Text>
            </div>

            <div className="flex flex-col gap-y-4">
              <div className="flex flex-col gap-y-2">
                <Label>Exchange Type</Label>
                <Select
                  value={exchangeType}
                  onValueChange={(v) => setExchangeType(v as "incoming" | "outgoing")}
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="incoming">
                      <div className="flex items-center gap-2">
                        <ArrowDownTray className="w-4 h-4" />
                        Incoming (from Producer)
                      </div>
                    </Select.Item>
                    <Select.Item value="outgoing">
                      <div className="flex items-center gap-2">
                        <ArrowUpTray className="w-4 h-4" />
                        Outgoing (to Distributor)
                      </div>
                    </Select.Item>
                  </Select.Content>
                </Select>
              </div>

              <div className="flex flex-col gap-y-2">
                <Label htmlFor="seller_id">
                  {exchangeType === "incoming" ? "Producer" : "Distributor"} Seller ID
                </Label>
                <Input
                  id="seller_id"
                  placeholder="sel_01ABC..."
                  value={sellerId}
                  onChange={(e) => setSellerId(e.target.value)}
                />
                <Text size="small" className="text-ui-fg-subtle">
                  Enter the seller ID of the {exchangeType === "incoming" ? "producer" : "distributor"}
                </Text>
              </div>

              <div className="flex flex-col gap-y-2">
                <Label htmlFor="pickup_time">Pickup Time (optional)</Label>
                <Input
                  id="pickup_time"
                  placeholder="e.g., Tuesdays 9am-12pm"
                  value={pickupTime}
                  onChange={(e) => setPickupTime(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-y-2">
                <Label htmlFor="pickup_instructions">Pickup Instructions (optional)</Label>
                <Input
                  id="pickup_instructions"
                  placeholder="e.g., Ring the bell at the back door"
                  value={pickupInstructions}
                  onChange={(e) => setPickupInstructions(e.target.value)}
                />
              </div>
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

interface AddProductsToExchangeModalProps {
  exchangeId: string
  orderCycleId: string
  sellerId: string
  existingVariantIds: string[]
  open: boolean
  onClose: () => void
}

const AddProductsToExchangeModal = ({
  exchangeId,
  orderCycleId,
  sellerId,
  existingVariantIds,
  open,
  onClose,
}: AddProductsToExchangeModalProps) => {
  const [search, setSearch] = useState("")
  const [selectedVariants, setSelectedVariants] = useState<Array<{ id: string; title: string; product_title: string }>>([])

  const addProducts = useAddProductsToExchange(orderCycleId)
  const { products, isLoading } = useProducts({
    q: search,
    limit: 20,
  })

  const handleSubmit = async () => {
    if (selectedVariants.length === 0) {
      toast.error("Please select at least one product")
      return
    }

    try {
      await addProducts.mutateAsync({
        exchangeId,
        products: selectedVariants.map((v) => ({
          variant_id: v.id,
        })),
      })
      toast.success("Products added to exchange")
      onClose()
      setSelectedVariants([])
    } catch (err) {
      toast.error("Failed to add products")
    }
  }

  const toggleVariant = (variant: { id: string; title: string; product_title: string }) => {
    setSelectedVariants((prev) => {
      const exists = prev.find((v) => v.id === variant.id)
      if (exists) {
        return prev.filter((v) => v.id !== variant.id)
      }
      return [...prev, variant]
    })
  }

  const variants =
    products?.flatMap((product: any) =>
      (product.variants || [])
        .filter((v: any) => !existingVariantIds.includes(v.id))
        .map((v: any) => ({
          id: v.id,
          title: v.title,
          product_title: product.title,
          sku: v.sku,
        }))
    ) || []

  return (
    <FocusModal open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} isLoading={addProducts.isPending}>
            Add {selectedVariants.length} Product{selectedVariants.length !== 1 ? "s" : ""}
          </Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-16">
          <div className="flex w-full max-w-lg flex-col gap-y-8">
            <div>
              <Heading>Add Products to Exchange</Heading>
              <Text className="text-ui-fg-subtle">
                Select products to include in this exchange
              </Text>
            </div>

            <div className="flex flex-col gap-y-4">
              <Input
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              {selectedVariants.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedVariants.map((v) => (
                    <Badge
                      key={v.id}
                      color="green"
                      className="cursor-pointer"
                      onClick={() => toggleVariant(v)}
                    >
                      {v.product_title} - {v.title} ×
                    </Badge>
                  ))}
                </div>
              )}

              <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                {isLoading ? (
                  <div className="p-4 text-center">
                    <Text className="text-ui-fg-subtle">Loading...</Text>
                  </div>
                ) : variants.length === 0 ? (
                  <div className="p-4 text-center">
                    <Text className="text-ui-fg-subtle">
                      {search ? "No products found" : "Search for products"}
                    </Text>
                  </div>
                ) : (
                  variants.map((variant: any) => {
                    const isSelected = selectedVariants.some((v) => v.id === variant.id)
                    return (
                      <button
                        key={variant.id}
                        className={`w-full px-4 py-3 text-left transition-colors ${
                          isSelected ? "bg-ui-bg-base-pressed" : "hover:bg-ui-bg-subtle"
                        }`}
                        onClick={() => toggleVariant(variant)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <Text weight="plus">{variant.product_title}</Text>
                            <Text size="small" className="text-ui-fg-subtle">
                              {variant.title}
                              {variant.sku && ` · ${variant.sku}`}
                            </Text>
                          </div>
                          {isSelected && (
                            <Badge color="green" size="small">
                              Selected
                            </Badge>
                          )}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

