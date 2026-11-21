import { HttpTypes } from "@medusajs/types"
import { castNumber } from "../../../lib/cast-number"
import { ProductCreateSchemaType } from "./types"

export const normalizeProductFormValues = (
  values: ProductCreateSchemaType & {
    status: HttpTypes.AdminProductStatus
    regionsCurrencyMap: Record<string, string>
  }
): HttpTypes.AdminCreateProduct => {
  const thumbnail = values.media?.find((media) => media.isThumbnail)?.url
  const images = values.media
    ?.filter((media) => !media.isThumbnail)
    .map((media) => ({ url: media.url }))

  return {
    status: values.status,
    is_giftcard: false,
    tags: values?.tags?.length
      ? values.tags?.map((tag) => ({ id: tag }))
      : undefined,
    sales_channels: values?.sales_channels?.length
      ? values.sales_channels?.map((sc) => ({ id: sc.id }))
      : undefined,
    images,
    collection_id: values.collection_id || undefined,
    shipping_profile_id: values.shipping_profile_id || undefined,
    categories: values.categories.map((id) => ({ id })),
    type_id: values.type_id || undefined,
    handle: values.handle || undefined,
    origin_country: values.origin_country || undefined,
    material: values.material || undefined,
    mid_code: values.mid_code || undefined,
    hs_code: values.hs_code || undefined,
    thumbnail,
    title: values.title,
    subtitle: values.subtitle || undefined,
    description: values.description || undefined,
    discountable: values.discountable || undefined,
    width: values.width ? parseFloat(values.width) : undefined,
    length: values.length ? parseFloat(values.length) : undefined,
    height: values.height ? parseFloat(values.height) : undefined,
    weight: values.weight ? parseFloat(values.weight) : undefined,
    options: values.options.filter((o) => o.title), // clean temp. values
    variants: normalizeVariants(
      values.variants.filter((variant) => variant.should_create),
      values.regionsCurrencyMap
    ),
  }
}

export const normalizeVariants = (
  variants: ProductCreateSchemaType["variants"],
  regionsCurrencyMap: Record<string, string>
): HttpTypes.AdminCreateProductVariant[] => {
  return variants.map((variant) => ({
    title: variant.title || Object.values(variant.options || {}).join(" / "),
    options: variant.options,
    sku: variant.sku || undefined,
    manage_inventory: !!variant.manage_inventory,
    allow_backorder: !!variant.allow_backorder,
    variant_rank: variant.variant_rank,
    inventory_items: (variant.inventory || [])
      .map((i) => {
        const quantity = i.required_quantity
          ? castNumber(i.required_quantity)
          : null

        if (!i.inventory_item_id || !quantity) {
          return false
        }

        return {
          ...i,
          required_quantity: quantity,
        }
      })
      .filter(
        (
          item
        ): item is { required_quantity: number; inventory_item_id: string } =>
          item !== false
      ),
    prices: Object.entries(variant.prices || {})
      .map(([key, value]) => {
        if (value === "" || value === undefined) {
          return undefined
        }

        if (key.startsWith("reg_")) {
          return {
            currency_code: regionsCurrencyMap[key],
            amount: castNumber(value),
            rules: { region_id: key },
          } as HttpTypes.AdminCreateProductVariantPrice
        } else {
          return {
            currency_code: key,
            amount: castNumber(value),
          } as HttpTypes.AdminCreateProductVariantPrice
        }
      })
      .filter((v) => v !== undefined),
  }))
}

export const decorateVariantsWithDefaultValues = (
  variants: ProductCreateSchemaType["variants"]
) => {
  return variants.map((variant) => ({
    ...variant,
    title: variant.title || "",
    sku: variant.sku || "",
    // Stock is tracked unless the vendor unticks it: what the form sent for
    // every variant before it asked.
    manage_inventory: variant.manage_inventory ?? true,
    stock_quantity: variant.stock_quantity ?? "",
    allow_backorder: variant.allow_backorder || false,
    inventory_kit: variant.inventory_kit || false,
  }))
}

type UploadedMedia = { url: string; isThumbnail: boolean }

/**
 * The product the create form sends to `POST /vendor/seller-products`.
 *
 * A variant tracks stock when the vendor left "Track stock" ticked. The form
 * sent `manage_inventory: true` for every variant and asked for no quantity,
 * so every product it made had an inventory item with no level anywhere and
 * could not be added to a cart (SD-151 (4)). Prices go as typed, in major
 * units.
 */
export const toCreateProductPayload = (
  values: ProductCreateSchemaType,
  {
    status,
    uploadedMedia,
    regionsCurrencyMap,
  }: {
    status: "draft" | "published"
    uploadedMedia: UploadedMedia[]
    regionsCurrencyMap: Record<string, string>
  }
): HttpTypes.AdminCreateProduct => {
  const payload = { ...values, media: undefined }

  return {
    ...payload,
    status,
    thumbnail: uploadedMedia.find((media) => media.isThumbnail)?.url,
    images: uploadedMedia
      .filter((media) => !media.isThumbnail)
      .map((media) => ({ url: media.url })),
    weight: parseInt(payload.weight || "") || undefined,
    length: parseInt(payload.length || "") || undefined,
    height: parseInt(payload.height || "") || undefined,
    width: parseInt(payload.width || "") || undefined,
    type_id: payload.type_id || undefined,
    tags:
      payload.tags?.map((tag) => ({
        id: tag,
      })) || [],
    collection_id: payload.collection_id || undefined,
    shipping_profile_id: undefined,
    enable_variants: undefined,
    // No listing type is named: the backend gives the product its seller's
    // playbook's default, and refuses in its own words when it cannot.
    additional_data: undefined,
    categories: payload.categories.map((cat) => ({
      id: cat,
    })),
    variants: payload.variants.map((variant) => {
      const prices = Object.entries(variant.prices || {})
        .map(([currencyOrRegion, value]) => {
          if (value === "" || value === undefined) {
            return undefined
          }

          const amount = castNumber(value)

          if (currencyOrRegion.startsWith("reg_")) {
            return {
              rules: { region_id: currencyOrRegion },
              currency_code: regionsCurrencyMap[currencyOrRegion],
              amount,
            }
          }

          return {
            currency_code: currencyOrRegion,
            amount,
          }
        })
        .filter((price) => !!price)

      return {
        ...variant,
        sku: variant.sku === "" ? undefined : variant.sku,
        manage_inventory: variant.manage_inventory !== false,
        allow_backorder: false,
        should_create: undefined,
        is_default: undefined,
        inventory_kit: undefined,
        inventory: undefined,
        stock_quantity: undefined,
        prices,
      }
    }),
  } as unknown as HttpTypes.AdminCreateProduct
}

const hasQuantity = (variant: ProductCreateSchemaType["variants"][number]) =>
  variant.stock_quantity !== "" && variant.stock_quantity !== undefined

/**
 * The stock the vendor entered, for the variants that track it: written as
 * each one's inventory level once the product exists (`recordStock`).
 */
export const initialStockFrom = (
  variants: ProductCreateSchemaType["variants"]
): Array<{ variant_rank: number; quantity: number }> =>
  variants
    .filter((variant) => variant.manage_inventory !== false)
    .filter(hasQuantity)
    .map((variant) => ({
      variant_rank: variant.variant_rank,
      quantity: castNumber(variant.stock_quantity as string | number),
    }))

/**
 * The variants (by index) the vendor has not answered for: shown in the grid,
 * tracking stock, with no quantity. Asked only while the store has a stock
 * location to hold it.
 */
export const variantsMissingStock = (
  variants: ProductCreateSchemaType["variants"],
  canHoldStock: boolean
): number[] =>
  canHoldStock
    ? variants.flatMap((variant, index) =>
        variant.should_create &&
        variant.manage_inventory !== false &&
        !hasQuantity(variant)
          ? [index]
          : []
      )
    : []
