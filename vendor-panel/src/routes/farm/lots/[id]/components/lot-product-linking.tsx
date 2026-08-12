import { Link as LinkIcon, Trash, Plus, ShoppingCart, InformationCircle, LightBulb, CheckCircle, ArrowRight } from "@medusajs/icons"
import {
  Container,
  Heading,
  Text,
  Button,
  Badge,
  Table,
  usePrompt,
  toast,
  Drawer,
  Label,
  Input,
  Select,
  Switch,
  Tooltip,
} from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { sdk } from "../../../../../lib/sdk"

// Help content
const LINKING_HELP = {
  what: "Linking connects your farm lot to a store product. When customers buy the product, inventory is deducted from this lot.",
  price: "This is what customers pay. Consider market rates and your costs when setting prices.",
  channel: "Different channels can have different prices. For example, wholesale buyers might get a discount.",
  sync: "When enabled, product inventory automatically updates when lot quantity changes."
}

interface LinkedProduct {
  id: string
  product_id: string
  unit_price: number
  currency_code: string
  sales_channel: string
  available_from: string
  available_until: string | null
  is_active: boolean
  product?: {
    id: string
    title: string
    thumbnail: string | null
    status: string
  }
}

interface Product {
  id: string
  title: string
  thumbnail: string | null
  status: string
  variants?: {
    id: string
    title: string
    sku: string | null
  }[]
}

const useLinkedProducts = (lotId: string) => {
  return useQuery({
    queryKey: ["lot-linked-products", lotId],
    queryFn: async () => {
      const response = await sdk.client.fetch<{ linked_products: LinkedProduct[] }>(
        `/vendor/farm/lots/${lotId}/link-product`
      )
      return response.linked_products
    },
    enabled: !!lotId,
  })
}

const useVendorProducts = () => {
  return useQuery({
    queryKey: ["vendor-products-for-linking"],
    queryFn: async () => {
      const response = await sdk.client.fetch<{ products: Product[] }>(
        `/vendor/products?limit=100`
      )
      return response.products
    },
  })
}

const useLinkProduct = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ lotId, data }: { lotId: string; data: Record<string, unknown> }) => {
      return sdk.client.fetch(`/vendor/farm/lots/${lotId}/link-product`, {
        method: "POST",
        body: data,
      })
    },
    onSuccess: (_, { lotId }) => {
      queryClient.invalidateQueries({ queryKey: ["lot-linked-products", lotId] })
      queryClient.invalidateQueries({ queryKey: ["farm-lot", lotId] })
    },
  })
}

const useUnlinkProduct = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ lotId, availabilityWindowId }: { lotId: string; availabilityWindowId: string }) => {
      return sdk.client.fetch(`/vendor/farm/lots/${lotId}/link-product`, {
        method: "DELETE",
        body: { availability_window_id: availabilityWindowId },
      })
    },
    onSuccess: (_, { lotId }) => {
      queryClient.invalidateQueries({ queryKey: ["lot-linked-products", lotId] })
      queryClient.invalidateQueries({ queryKey: ["farm-lot", lotId] })
    },
  })
}

const SALES_CHANNELS = [
  { value: "DTC", label: "Direct to Consumer" },
  { value: "B2B", label: "Business to Business" },
  { value: "CSA", label: "CSA Share" },
  { value: "WHOLESALE", label: "Wholesale" },
  { value: "FARMERS_MARKET", label: "Farmers Market" },
]

interface LotProductLinkingProps {
  lotId: string
  suggestedPrice?: number
  unit?: string
}

export const LotProductLinking = ({ lotId, suggestedPrice, unit }: LotProductLinkingProps) => {
  const prompt = usePrompt()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<string>("")
  const [unitPrice, setUnitPrice] = useState(suggestedPrice?.toString() || "")
  const [salesChannel, setSalesChannel] = useState("DTC")
  const [syncInventory, setSyncInventory] = useState(true)

  const { data: linkedProducts, isLoading } = useLinkedProducts(lotId)
  const { data: products } = useVendorProducts()
  const linkProduct = useLinkProduct()
  const unlinkProduct = useUnlinkProduct()

  // Filter out already linked products
  const linkedProductIds = new Set((linkedProducts || []).map(lp => lp.product_id))
  const availableProducts = (products || []).filter(p => !linkedProductIds.has(p.id))

  const handleLink = async () => {
    if (!selectedProduct) {
      toast.error("Please select a product")
      return
    }

    if (!unitPrice || parseFloat(unitPrice) <= 0) {
      toast.error("Please enter a valid price")
      return
    }

    try {
      await linkProduct.mutateAsync({
        lotId,
        data: {
          product_id: selectedProduct,
          unit_price: parseFloat(unitPrice),
          sales_channel: salesChannel,
          sync_inventory: syncInventory,
        },
      })
      toast.success("Product linked successfully")
      setIsDrawerOpen(false)
      setSelectedProduct("")
      setUnitPrice(suggestedPrice?.toString() || "")
    } catch {
      toast.error("Failed to link product")
    }
  }

  const handleUnlink = async (linkedProduct: LinkedProduct) => {
    const confirmed = await prompt({
      title: "Unlink Product",
      description: `Are you sure you want to unlink "${linkedProduct.product?.title}"? This will remove the availability window.`,
      confirmText: "Unlink",
      cancelText: "Cancel",
    })

    if (confirmed) {
      try {
        await unlinkProduct.mutateAsync({
          lotId,
          availabilityWindowId: linkedProduct.id,
        })
        toast.success("Product unlinked")
      } catch {
        toast.error("Failed to unlink product")
      }
    }
  }

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          <LinkIcon className="w-5 h-5 text-ui-fg-muted" />
          <Heading level="h2">Linked Products</Heading>
          {linkedProducts && linkedProducts.length > 0 && (
            <Badge color="green" size="xsmall">{linkedProducts.length} linked</Badge>
          )}
          <Tooltip content={LINKING_HELP.what}>
            <InformationCircle className="w-4 h-4 text-ui-fg-muted cursor-help" />
          </Tooltip>
        </div>
        <Button size="small" onClick={() => setIsDrawerOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Link Product
        </Button>
      </div>

      <div className="px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-ui-fg-base"></div>
          </div>
        ) : !linkedProducts || linkedProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-y-4 bg-gradient-to-b from-ui-bg-subtle to-white rounded-lg border-2 border-dashed border-ui-border-base">
            <div className="w-16 h-16 rounded-full bg-purple-50 flex items-center justify-center">
              <ShoppingCart className="w-8 h-8 text-purple-600" />
            </div>
            <Heading level="h3">Ready to get started?</Heading>
            <Text className="text-ui-fg-subtle text-center max-w-md">
              Link this lot to a product in your store. When customers purchase the product, 
              inventory will be automatically tracked from this lot.
            </Text>
            
            {/* Step by step */}
            <div className="bg-white rounded-lg p-4 max-w-md w-full shadow-sm border">
              <Text className="font-medium text-sm mb-3 flex items-center gap-2">
                <LightBulb className="w-4 h-4 text-amber-500" />
                How it works
              </Text>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-medium flex-shrink-0">1</div>
                  <div>
                    <Text className="font-medium text-sm">Choose a product</Text>
                    <Text className="text-ui-fg-subtle text-xs">Select from your store's existing products</Text>
                  </div>
                </div>
                <div className="flex items-center justify-center">
                  <ArrowRight className="w-4 h-4 text-ui-fg-muted" />
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-medium flex-shrink-0">2</div>
                  <div>
                    <Text className="font-medium text-sm">Set your price</Text>
                    <Text className="text-ui-fg-subtle text-xs">Define what customers pay per unit</Text>
                  </div>
                </div>
                <div className="flex items-center justify-center">
                  <ArrowRight className="w-4 h-4 text-ui-fg-muted" />
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-sm font-medium flex-shrink-0">✓</div>
                  <div>
                    <Text className="font-medium text-sm">Start offering</Text>
                    <Text className="text-ui-fg-subtle text-xs">Inventory syncs automatically with orders</Text>
                  </div>
                </div>
              </div>
            </div>

            <Button onClick={() => setIsDrawerOpen(true)} className="mt-2">
              <Plus className="w-4 h-4 mr-2" />
              Link Your First Product
            </Button>
          </div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Product</Table.HeaderCell>
                <Table.HeaderCell>Price</Table.HeaderCell>
                <Table.HeaderCell>Channel</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell></Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {linkedProducts.map((lp) => (
                <Table.Row key={lp.id}>
                  <Table.Cell>
                    <div className="flex items-center gap-3">
                      {lp.product?.thumbnail ? (
                        <img
                          src={lp.product.thumbnail}
                          alt={lp.product?.title}
                          className="w-10 h-10 object-cover rounded"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-ui-bg-subtle rounded flex items-center justify-center">
                          <ShoppingCart className="w-5 h-5 text-ui-fg-muted" />
                        </div>
                      )}
                      <div>
                        <Text className="font-medium">
                          {lp.product?.title || "Unknown Product"}
                        </Text>
                        <Text className="text-ui-fg-subtle text-sm">
                          ID: {lp.product_id.slice(-8)}
                        </Text>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="font-medium">
                      ${lp.unit_price.toFixed(2)}{unit && ` / ${unit}`}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color="grey" size="small">
                      {SALES_CHANNELS.find(c => c.value === lp.sales_channel)?.label || lp.sales_channel}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {lp.is_active ? (
                      <Badge color="green" size="small">Active</Badge>
                    ) : (
                      <Badge color="grey" size="small">Inactive</Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Button
                      variant="transparent"
                      size="small"
                      onClick={() => handleUnlink(lp)}
                    >
                      <Trash className="w-4 h-4 text-ui-fg-error" />
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>

      {/* Link Product Drawer */}
      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Link Product to Lot</Drawer.Title>
            <Text className="text-ui-fg-subtle text-sm mt-1">
              Connect this inventory to a store product
            </Text>
          </Drawer.Header>
          <Drawer.Body className="p-6 space-y-6">
            {/* Quick tip */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <InformationCircle className="w-4 h-4 text-blue-600 mt-0.5" />
                <Text className="text-blue-700 text-sm">
                  Don't have a product yet? Create one in <strong>Products</strong> first, 
                  then come back to link it.
                </Text>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1 mb-1">
                <Label htmlFor="product">Select Product</Label>
                <Badge color="red" size="xsmall">Required</Badge>
              </div>
              <Text className="text-ui-fg-subtle text-sm mb-2">
                Choose a product from your store to link to this lot
              </Text>
              <Select
                value={selectedProduct}
                onValueChange={setSelectedProduct}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Select a product..." />
                </Select.Trigger>
                <Select.Content>
                  {availableProducts.length === 0 ? (
                    <Select.Item value="none" disabled>
                      No products available to link
                    </Select.Item>
                  ) : (
                    availableProducts.map((product) => (
                      <Select.Item key={product.id} value={product.id}>
                        {product.title}
                      </Select.Item>
                    ))
                  )}
                </Select.Content>
              </Select>
              {availableProducts.length === 0 && linkedProducts && linkedProducts.length > 0 && (
                <Text className="text-ui-fg-muted text-xs mt-2">
                  All your products are already linked to this lot
                </Text>
              )}
            </div>

            <div>
              <div className="flex items-center gap-1 mb-1">
                <Label htmlFor="price">Price per Unit</Label>
                <Tooltip content={LINKING_HELP.price}>
                  <InformationCircle className="w-3.5 h-3.5 text-ui-fg-muted cursor-help" />
                </Tooltip>
              </div>
              <Text className="text-ui-fg-subtle text-sm mb-2">
                What customers will pay{unit && ` (per ${unit})`}
              </Text>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-fg-muted">$</span>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
              {suggestedPrice && (
                <Text className="text-ui-fg-muted text-xs mt-1">
                  Suggested: ${suggestedPrice.toFixed(2)}{unit && ` per ${unit}`}
                </Text>
              )}
            </div>

            <div>
              <div className="flex items-center gap-1 mb-1">
                <Label htmlFor="channel">Sales Channel</Label>
                <Tooltip content={LINKING_HELP.channel}>
                  <InformationCircle className="w-3.5 h-3.5 text-ui-fg-muted cursor-help" />
                </Tooltip>
              </div>
              <Text className="text-ui-fg-subtle text-sm mb-2">
                Where this product will be available
              </Text>
              <Select
                value={salesChannel}
                onValueChange={setSalesChannel}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {SALES_CHANNELS.map((channel) => (
                    <Select.Item key={channel.value} value={channel.value}>
                      <div className="flex items-center gap-2">
                        <span>{channel.label}</span>
                        {channel.value === "DTC" && (
                          <Badge color="green" size="xsmall">Recommended</Badge>
                        )}
                      </div>
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

            <div className="flex items-center justify-between p-4 bg-ui-bg-subtle rounded-lg">
              <div>
                <div className="flex items-center gap-1">
                  <Label>Sync Inventory</Label>
                  <Tooltip content={LINKING_HELP.sync}>
                    <InformationCircle className="w-3.5 h-3.5 text-ui-fg-muted cursor-help" />
                  </Tooltip>
                </div>
                <Text className="text-ui-fg-subtle text-sm">
                  Keep product inventory in sync with lot quantity
                </Text>
              </div>
              <Switch
                checked={syncInventory}
                onCheckedChange={setSyncInventory}
              />
            </div>

            {/* Summary */}
            {selectedProduct && unitPrice && (
              <div className="border-t pt-4">
                <Text className="font-medium mb-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Summary
                </Text>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
                  <Text className="text-green-800 text-sm">
                    <strong>{products?.find(p => p.id === selectedProduct)?.title}</strong> will be 
                    available for <strong>${parseFloat(unitPrice).toFixed(2)}{unit && ` per ${unit}`}</strong> on 
                    the <strong>{SALES_CHANNELS.find(c => c.value === salesChannel)?.label}</strong> channel
                  </Text>
                  {syncInventory && (
                    <Text className="text-green-700 text-xs">
                      Inventory will sync automatically
                    </Text>
                  )}
                </div>
              </div>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Drawer.Close>
            <Button
              onClick={handleLink}
              disabled={!selectedProduct || linkProduct.isPending}
            >
              {linkProduct.isPending ? "Linking..." : "Link Product"}
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}

export default LotProductLinking
