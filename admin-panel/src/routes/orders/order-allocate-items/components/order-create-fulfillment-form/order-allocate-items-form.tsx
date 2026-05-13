import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import type * as zod from "zod"

import type {
  AdminOrder,
  HttpTypes,
  InventoryItemDTO,
  OrderLineItemDTO,
} from "@medusajs/types"
import { Alert, Button, Heading, Input, Select, toast } from "@medusajs/ui"
import { useForm, useWatch } from "react-hook-form"

import { Form } from "@components/common/form"
import {
  RouteFocusModal,
  useRouteModal,
} from "@components/modals"
import { KeyboundForm } from "@components/utilities/keybound-form"
import { ordersQueryKeys } from "@hooks/api/orders"
import { useCreateReservationItem } from "@hooks/api/reservations"
import { useStockLocations } from "@hooks/api/stock-locations"
import { queryClient } from "@lib/query-client"
import { AllocateItemsSchema } from "@routes/orders/order-allocate-items/components/order-create-fulfillment-form/constants"
import { OrderAllocateItemsItem } from "@routes/orders/order-allocate-items/components/order-create-fulfillment-form/order-allocate-items-item"
import { checkInventoryKit } from "@routes/orders/order-allocate-items/components/order-create-fulfillment-form/utils"
import { useDocumentDirection } from "@hooks/use-document-direction"

type OrderAllocateItemsFormProps = {
  order: AdminOrder
}

export function OrderAllocateItemsForm({ order }: OrderAllocateItemsFormProps) {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const direction = useDocumentDirection()
  const [disableSubmit, setDisableSubmit] = useState(false)
  const [filterTerm, setFilterTerm] = useState("")

  const { mutateAsync: allocateItems, isPending: isMutating } =
    useCreateReservationItem()

  const itemsToAllocate = useMemo(
    () =>
      order.items.filter(
        (item) =>
          item.variant?.manage_inventory &&
          // AdminProductVariant in @medusajs/types omits the `inventory`
          // join; the response inlines it when fetched with
          // `+variant.inventory.location_levels`.
          ((item.variant as unknown as { inventory?: unknown[] })?.inventory
            ?.length ?? 0) > 0 &&
          item.quantity - item.detail.fulfilled_quantity > 0
      ),
    [order.items]
  )

  const filteredItems = useMemo(() => {
    const searchTerm = filterTerm.trim().toLowerCase()

    return itemsToAllocate.filter(
      (i) =>
        i.variant_title?.toLowerCase().includes(searchTerm) ||
        i.product_title?.toLowerCase().includes(searchTerm)
    )
  }, [itemsToAllocate, filterTerm])

  const noItemsToAllocate = !itemsToAllocate.length

  const form = useForm<zod.infer<typeof AllocateItemsSchema>>({
    defaultValues: {
      location_id: "",
      quantity: defaultAllocations(itemsToAllocate as unknown as ItemWithInventory[]),
    },
    resolver: zodResolver(AllocateItemsSchema),
  })

  const { stock_locations = [] } = useStockLocations()

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      const payload = Object.entries(data.quantity)
        .filter(([key]) => !key.endsWith("-"))
        .map(([key, quantity]) => [...key.split("-"), quantity])

      if (payload.some((d) => d[2] === "")) {
        form.setError("root.quantityNotAllocated", {
          type: "manual",
          message: t("orders.allocateItems.error.quantityNotAllocated"),
        })

        return
      }

      const promises = payload.map(([itemId, inventoryId, quantity]) =>
        allocateItems({
          location_id: data.location_id,
          inventory_item_id: inventoryId as string,
          line_item_id: itemId as string,
          quantity: Number(quantity),
        })
          .then(() => ({ success: true, inventory_item_id: inventoryId }))
          .catch(() => ({ success: false, inventory_item_id: inventoryId }))
      )

      /**
       * TODO: we should have bulk endpoint for this so this is executed in a workflow and can be reverted
       */
      const results = await Promise.all(promises)

      // invalidate order details so we get new item.variant.inventory items
      await queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      handleSuccess(`/orders/${order.id}`)

      if (results.some((r) => !r.success)) {
        const failedItems = results
          .filter((r) => !r.success)
          .map((r) => r.inventory_item_id)
          .join(", ")

        toast.error(t("general.error"), {
          description: t("orders.allocateItems.toast.error", {
            items: failedItems,
          }),
        })
      }
    } catch (e) {
      toast.error(t("general.error"), {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  })

  const onQuantityChange = (
    inventoryItem: InventoryItemDTO,
    lineItem: OrderLineItemDTO | HttpTypes.AdminOrderLineItem,
    hasInventoryKit: boolean,
    value: number | null,
    isRoot?: boolean
  ) => {
    let shouldDisableSubmit = false

    // useForm.setValue's name parameter is the typed key union; the
    // dynamic `quantity.${string}` form is valid at runtime but doesn't
    // pre-narrow to the union, so cast through `any` at the call site.
    const key = (
      isRoot && hasInventoryKit
        ? `quantity.${lineItem.id}-`
        : `quantity.${lineItem.id}-${inventoryItem.id}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any

    form.setValue(key, value)

    if (value) {
      // InventoryItemDTO omits the embedded `location_levels` join in
      // the SDK type; the response includes it when fetched with
      // `+location_levels.*`. Cast structurally.
      const location = (
        inventoryItem as {
          location_levels?: Array<{
            location_id: string
            available_quantity?: number
          }>
        }
      ).location_levels?.find((l) => l.location_id === selectedLocationId)
      if (location && (location.available_quantity ?? 0) < value) {
        shouldDisableSubmit = true
      }
    }

    if (hasInventoryKit && !isRoot) {
      // changed subitem in the kit -> we need to set parent to "-"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      form.resetField(`quantity.${lineItem.id}-` as any, { defaultValue: "" })
    }

    if (hasInventoryKit && isRoot) {
      // changed root -> we need to set items to parent quantity x required_quantity

      const item = itemsToAllocate.find((i) => i.id === lineItem.id) as
        | (typeof itemsToAllocate[number] & {
            variant?: {
              inventory_items?: Array<{ required_quantity?: number }>
              inventory?: Array<{
                id: string
                location_levels?: Array<{
                  location_id: string
                  available_quantity?: number
                }>
              }>
            }
          })
        | undefined

      item?.variant?.inventory_items?.forEach((ii, ind) => {
        const num = value || 0
        const inventory = item.variant?.inventory?.[ind]
        if (!inventory) return

        form.setValue(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          `quantity.${lineItem.id}-${inventory.id}` as any,
          num * (ii.required_quantity ?? 1)
        )

        if (value) {
          const location = inventory.location_levels?.find(
            (l) => l.location_id === selectedLocationId
          )
          if (location && (location.available_quantity ?? 0) < value) {
            shouldDisableSubmit = true
          }
        }
      })
    }

    form.clearErrors("root.quantityNotAllocated")
    setDisableSubmit(shouldDisableSubmit)
  }

  const selectedLocationId = useWatch({
    name: "location_id",
    control: form.control,
  })

  useEffect(() => {
    if (selectedLocationId) {
      form.setValue("quantity", defaultAllocations(itemsToAllocate as unknown as ItemWithInventory[]))
    }
  }, [selectedLocationId])

  const allocationError =
    form.formState.errors?.root?.quantityNotAllocated?.message

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex h-full flex-col overflow-hidden"
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex h-full w-full flex-col items-center divide-y overflow-y-auto">
          <div className="flex size-full flex-col items-center overflow-auto p-16">
            <div className="flex w-full max-w-[736px] flex-col justify-center px-2 pb-2">
              <div className="flex flex-col gap-8 divide-y divide-dashed">
                <Heading>{t("orders.allocateItems.title")}</Heading>
                <div className="flex-1 divide-y divide-dashed pt-8">
                  <Form.Field
                    control={form.control}
                    name="location_id"
                    render={({ field: { onChange, ref, ...field } }) => {
                      return (
                        <Form.Item>
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <Form.Label>{t("fields.location")}</Form.Label>
                              <Form.Hint>
                                {t("orders.allocateItems.locationDescription")}
                              </Form.Hint>
                            </div>
                            <div className="flex-1">
                              <Form.Control>
                                <Select
                                  dir={direction}
                                  onValueChange={onChange}
                                  {...field}
                                >
                                  <Select.Trigger
                                    className="bg-ui-bg-base"
                                    ref={ref}
                                  >
                                    <Select.Value />
                                  </Select.Trigger>
                                  <Select.Content>
                                    {stock_locations.map((l) => (
                                      <Select.Item key={l.id} value={l.id}>
                                        {l.name}
                                      </Select.Item>
                                    ))}
                                  </Select.Content>
                                </Select>
                              </Form.Control>
                            </div>
                          </div>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />

                  <Form.Item className="mt-8 pt-8">
                    <div className="flex flex-row items-center">
                      <div className="flex-1">
                        <Form.Label>
                          {t("orders.allocateItems.itemsToAllocate")}
                        </Form.Label>
                        <Form.Hint>
                          {t("orders.allocateItems.itemsToAllocateDesc")}
                        </Form.Hint>
                      </div>
                      <div className="flex-1">
                        <Input
                          value={filterTerm}
                          onChange={(e) => setFilterTerm(e.target.value)}
                          placeholder={t("orders.allocateItems.search")}
                          autoComplete="off"
                          type="search"
                        />
                      </div>
                    </div>

                    {allocationError && (
                      <Alert className="mb-4" dismissible variant="error">
                        {allocationError}
                      </Alert>
                    )}

                    <div className="flex flex-col gap-y-1">
                      {noItemsToAllocate ? (
                        <Alert variant="info">
                          {t("orders.fulfillment.error.noItems")}
                        </Alert>
                      ) : (
                        filteredItems.map((item) => (
                          <OrderAllocateItemsItem
                            key={item.id}
                            form={form}
                            // OrderAllocateItemsItem's local
                            // LineItemWithVariant intersects
                            // AdminOrderLineItem with the embedded
                            // variant.inventory join; the response
                            // shape matches at runtime.
                            item={
                              item as unknown as Parameters<
                                typeof OrderAllocateItemsItem
                              >[0]["item"]
                            }
                            locationId={selectedLocationId}
                            onQuantityChange={onQuantityChange}
                          />
                        ))
                      )}
                    </div>
                  </Form.Item>
                </div>
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteFocusModal.Close>
            <Button
              size="small"
              type="submit"
              isLoading={isMutating}
              disabled={!selectedLocationId || disableSubmit || noItemsToAllocate}
            >
              {t("orders.allocateItems.action")}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

type InventoryRow = { id: string }
type ItemWithInventory = (OrderLineItemDTO | HttpTypes.AdminOrderLineItem) & {
  variant?: { inventory?: InventoryRow[]; [k: string]: unknown }
}

function defaultAllocations(items: ItemWithInventory[]) {
  const ret: Record<string, string> = {}

  items.forEach((item) => {
    const hasInventoryKit = checkInventoryKit(
      item as unknown as Parameters<typeof checkInventoryKit>[0]
    )

    ret[
      hasInventoryKit
        ? `${item.id}-`
        : `${item.id}-${item.variant?.inventory?.[0]?.id}`
    ] = ""

    if (hasInventoryKit) {
      item.variant?.inventory?.forEach((i) => {
        ret[`${item.id}-${i.id}`] = ""
      })
    }
  })

  return ret
}
