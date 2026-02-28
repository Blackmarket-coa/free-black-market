import { Button, Input, Select, Text, Textarea, toast } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import * as zod from "zod"

import { ExtendedAdminProduct } from "../../../../../types/products"
import { Form } from "../../../../../components/common/form"
import { SwitchBox } from "../../../../../components/common/switch-box"
import { RouteDrawer, useRouteModal } from "../../../../../components/modals"
import { useExtendableForm } from "../../../../../extensions/forms/hooks"
import { useUpdateProduct } from "../../../../../hooks/api/products"

import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import {
  FormExtensionZone,
  useDashboardExtension,
} from "../../../../../extensions"

type EditProductFormProps = {
  product: ExtendedAdminProduct
}

const EditProductSchema = zod.object({
  title: zod.string().min(1),
  handle: zod.string().min(1),
  description: zod.string().optional(),
  discountable: zod.boolean(),
  status: zod.enum(["draft", "published", "proposed", "rejected"]),
  fulfillment_type: zod.enum(["dropship", "self_ship", "local"]).optional(),
  supplier_name: zod.string().optional(),
  inventory_quantity: zod.coerce.number().int().min(0).optional(),
  low_stock_threshold: zod.coerce.number().int().min(0).optional(),
})

export const EditProductForm = ({ product }: EditProductFormProps) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()

  const { getFormFields, getFormConfigs } = useDashboardExtension()
  const fields = getFormFields("product", "edit")
  const configs = getFormConfigs("product", "edit")

  const productMetadata = (product.metadata || {}) as Record<string, any>

  const form = useExtendableForm({
    defaultValues: {
      title: product.title,
      handle: product.handle || "",
      description: product.description || "",
      discountable: product.discountable,
      status: product.status as "draft" | "published" | "proposed" | "rejected",
      fulfillment_type: (productMetadata.fulfillment_type as "dropship" | "self_ship" | "local") || undefined,
      supplier_name: (productMetadata.supplier_name as string) || "",
      inventory_quantity: productMetadata.inventory_quantity != null ? Number(productMetadata.inventory_quantity) : undefined,
      low_stock_threshold: productMetadata.low_stock_threshold != null ? Number(productMetadata.low_stock_threshold) : undefined,
    },
    schema: EditProductSchema,
    configs: configs,
    data: product,
  })

  const { mutateAsync, isPending } = useUpdateProduct(product.id)

  const handleSubmit = form.handleSubmit(async (data) => {
    const {
      description,
      discountable,
      handle,
      title,
      status,
      fulfillment_type,
      supplier_name,
      inventory_quantity,
      low_stock_threshold,
    } = data

    await mutateAsync(
      {
        description,
        discountable,
        handle,
        title,
        status: status as any,
        metadata: {
          ...productMetadata,
          fulfillment_type: fulfillment_type || null,
          supplier_name: supplier_name || null,
          inventory_quantity: inventory_quantity != null ? inventory_quantity : null,
          low_stock_threshold: low_stock_threshold != null ? low_stock_threshold : null,
        },
      },
      {
        onSuccess: ({ product }) => {
          toast.success(
            t("products.edit.successToast", {
              title: product.title,
            })
          )
          handleSuccess(`/products/${product.id}`)
        },
        onError: (e) => {
          toast.error(e.message)
        },
      }
    )
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto">
          <div className="flex flex-col gap-y-8">
            <div className="flex flex-col gap-y-4">
              <Form.Field
                control={form.control}
                name="status"
                render={({ field: { onChange, ref, ...field } }) => {
                  return (
                    <Form.Item>
                      <Form.Label>{t("fields.status")}</Form.Label>
                      <Form.Control>
                        <Select {...field} onValueChange={onChange}>
                          <Select.Trigger ref={ref}>
                            <Select.Value />
                          </Select.Trigger>
                          <Select.Content>
                            {(
                              [
                                "draft",
                                "published",
                                "proposed",
                                "rejected",
                              ] as const
                            ).map((status) => {
                              return (
                                <Select.Item key={status} value={status}>
                                  {t(`products.productStatus.${status}`)}
                                </Select.Item>
                              )
                            })}
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )
                }}
              />
              <Form.Field
                control={form.control}
                name="title"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label>{t("fields.title")}</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )
                }}
              />
              <Form.Field
                control={form.control}
                name="handle"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label>{t("fields.handle")}</Form.Label>
                      <Form.Control>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 z-10 flex w-8 items-center justify-center border-r">
                            <Text
                              className="text-ui-fg-muted"
                              size="small"
                              leading="compact"
                              weight="plus"
                            >
                              /
                            </Text>
                          </div>
                          <Input {...field} className="pl-10" />
                        </div>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )
                }}
              />
              <Form.Field
                control={form.control}
                name="description"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label optional>
                        {t("fields.description")}
                      </Form.Label>
                      <Form.Control>
                        <Textarea {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )
                }}
              />
            </div>

            {/* Fulfillment & Supplier Section */}
            <div className="flex flex-col gap-y-4">
              <Text size="small" weight="plus" className="text-ui-fg-base">
                Fulfillment & Supplier
              </Text>
              <Form.Field
                control={form.control}
                name="fulfillment_type"
                render={({ field: { onChange, ref, value, ...field } }) => {
                  return (
                    <Form.Item>
                      <Form.Label optional>Fulfillment Type</Form.Label>
                      <Form.Control>
                        <Select value={value || ""} onValueChange={onChange}>
                          <Select.Trigger ref={ref}>
                            <Select.Value placeholder="Select fulfillment type" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Item value="dropship">Dropship</Select.Item>
                            <Select.Item value="self_ship">Self Ship</Select.Item>
                            <Select.Item value="local">Local Pickup</Select.Item>
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )
                }}
              />
              <Form.Field
                control={form.control}
                name="supplier_name"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label optional>Supplier</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="Enter supplier name" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )
                }}
              />
            </div>

            {/* Inventory Section */}
            <div className="flex flex-col gap-y-4">
              <Text size="small" weight="plus" className="text-ui-fg-base">
                Inventory
              </Text>
              <Form.Field
                control={form.control}
                name="inventory_quantity"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label optional>Inventory Quantity</Form.Label>
                      <Form.Control>
                        <Input
                          type="number"
                          min={0}
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const val = e.target.value
                            field.onChange(val === "" ? undefined : Number(val))
                          }}
                          placeholder="0"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )
                }}
              />
              <Form.Field
                control={form.control}
                name="low_stock_threshold"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label optional>Low Stock Threshold</Form.Label>
                      <Form.Control>
                        <Input
                          type="number"
                          min={0}
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const val = e.target.value
                            field.onChange(val === "" ? undefined : Number(val))
                          }}
                          placeholder="0"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )
                }}
              />
            </div>

            <SwitchBox
              control={form.control}
              name="discountable"
              label={t("fields.discountable")}
              description={t("products.discountableHint")}
            />
            <FormExtensionZone fields={fields} form={form} />
          </div>
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteDrawer.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
