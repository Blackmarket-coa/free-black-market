import { useMemo } from "react"
import { UseFormReturn, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { HttpTypes } from "@medusajs/types"

import {
  createDataGridHelper,
  createDataGridPriceColumns,
  DataGrid,
} from "../../../../../components/data-grid"
import { useRouteModal } from "../../../../../components/modals"
import {
  ProductCreateOptionSchema,
  ProductCreateVariantSchema,
} from "../../constants"
import { ProductCreateSchemaType } from "../../types"

type ProductCreateVariantsFormProps = {
  form: UseFormReturn<ProductCreateSchemaType>
  regions?: HttpTypes.AdminRegion[]
  store?: HttpTypes.AdminStore
  pricePreferences?: HttpTypes.AdminPricePreference[]
  /** Where the quantities entered here are held, when the store has a place. */
  stockLocation?: { id: string; name: string } | null
  /** Whether that location is linked to the store's sales channel. */
  stockLocationLinked?: boolean
  stockLocationPending?: boolean
  /** The store's locations could not be read. */
  stockLocationUnread?: boolean
}

/**
 * What the vendor is told about stock above the variants (SD-151 (4)): where
 * it is held, or why none can be recorded. The form sent every variant as
 * stock-tracked and asked for no quantity, so every product it made was out
 * of stock everywhere.
 */
export const StockNote = ({
  stockLocation,
  stockLocationLinked,
  stockLocationPending,
  stockLocationUnread,
}: Pick<
  ProductCreateVariantsFormProps,
  | "stockLocation"
  | "stockLocationLinked"
  | "stockLocationPending"
  | "stockLocationUnread"
>) => {
  if (stockLocationPending) {
    return null
  }
  const untrack =
    "Untick Track stock for anything you never run out of: it can then always be bought."

  return (
    <div className="bg-ui-bg-subtle txt-compact-small text-ui-fg-subtle px-4 py-3">
      {stockLocation ? (
        <>
          <span className="text-ui-fg-base">
            Stock is held at {stockLocation.name}.
          </span>{" "}
          Enter how many of each you have under In stock. {untrack}
          {stockLocationLinked ? null : (
            <>
              {" "}
              {stockLocation.name} is not linked to your sales channel yet, so
              buyers cannot buy from it:{" "}
              <Link
                to="/delivery-setup"
                target="_blank"
                rel="noreferrer"
                className="text-ui-fg-interactive"
              >
                finish pickup and shipping
              </Link>{" "}
              (opens in a new tab, so this form is kept).
            </>
          )}
        </>
      ) : stockLocationUnread ? (
        <>
          <span className="text-ui-fg-base">
            Your stock locations could not be read, so no stock will be
            recorded with this product.
          </span>{" "}
          Enter it on the product's Stock page afterwards. {untrack}
        </>
      ) : (
        <>
          <span className="text-ui-fg-base">
            You have no stock location yet, so no stock can be recorded.
          </span>{" "}
          A product that tracks stock and has none cannot be bought.{" "}
          <Link
            to="/delivery-setup"
            target="_blank"
            rel="noreferrer"
            className="text-ui-fg-interactive"
          >
            Set up pickup or shipping
          </Link>{" "}
          first (it opens in a new tab, so this form is kept), or untick Track
          stock.
        </>
      )}
    </div>
  )
}

type VariantWithIndex = ProductCreateVariantSchema & {
  originalIndex: number
}

export const ProductCreateVariantsForm = ({
  form,
  regions,
  store,
  pricePreferences,
  stockLocation,
  stockLocationLinked,
  stockLocationPending,
  stockLocationUnread,
}: ProductCreateVariantsFormProps) => {
  const { setCloseOnEscape } = useRouteModal()

  const currencyCodes = useMemo(
    () => store?.supported_currencies?.map((c) => c.currency_code) || [],
    [store]
  )

  const variants = useWatch({
    control: form.control,
    name: "variants",
    defaultValue: [],
  })

  const options = useWatch({
    control: form.control,
    name: "options",
    defaultValue: [],
  })

  /**
   * NOTE: anything that goes to the datagrid component needs to be memoised otherwise DataGrid will rerender and inputs will loose focus
   */
  const columns = useColumns({
    options,
    currencies: currencyCodes,
    regions,
    pricePreferences,
    // A quantity is asked for only where there is a place to hold it.
    canHoldStock: Boolean(stockLocation),
  })

  const variantData = useMemo(() => {
    const ret: VariantWithIndex[] = []

    variants.forEach((v, i) => {
      if (v.should_create) {
        ret.push({ ...v, originalIndex: i })
      }
    })

    return ret
  }, [variants])

  return (
    <div className="flex size-full flex-col divide-y overflow-hidden">
      <StockNote
        stockLocation={stockLocation}
        stockLocationLinked={stockLocationLinked}
        stockLocationPending={stockLocationPending}
        stockLocationUnread={stockLocationUnread}
      />
      <DataGrid
        columns={columns}
        data={variantData}
        state={form}
        onEditingChange={(editing) => setCloseOnEscape(!editing)}
      />
    </div>
  )
}

const columnHelper = createDataGridHelper<
  VariantWithIndex,
  ProductCreateSchemaType
>()

const useColumns = ({
  options,
  currencies = [],
  regions = [],
  pricePreferences = [],
  canHoldStock = false,
}: {
  options: ProductCreateOptionSchema[]
  currencies?: string[]
  regions?: HttpTypes.AdminRegion[]
  pricePreferences?: HttpTypes.AdminPricePreference[]
  canHoldStock?: boolean
}) => {
  const { t } = useTranslation()

  return useMemo(
    () => [
      columnHelper.column({
        id: "options",
        header: () => (
          <div className="flex size-full items-center overflow-hidden">
            <span className="truncate">
              {options.map((o) => o.title).join(" / ")}
            </span>
          </div>
        ),
        cell: (context) => {
          return (
            <DataGrid.ReadonlyCell context={context}>
              {options
                .map((o) => context.row.original.options[o.title])
                .join(" / ")}
            </DataGrid.ReadonlyCell>
          )
        },
        disableHiding: true,
      }),
      columnHelper.column({
        id: "title",
        name: t("fields.title"),
        header: t("fields.title"),
        field: (context) =>
          `variants.${context.row.original.originalIndex}.title`,
        type: "text",
        cell: (context) => {
          return <DataGrid.TextCell context={context} />
        },
      }),
      columnHelper.column({
        id: "sku",
        name: t("fields.sku"),
        header: t("fields.sku"),
        field: (context) =>
          `variants.${context.row.original.originalIndex}.sku`,
        type: "text",
        cell: (context) => {
          return <DataGrid.TextCell context={context} />
        },
      }),
      // The vendor's choice: a variant that does not track stock can always
      // be bought, one that does needs a quantity.
      columnHelper.column({
        id: "manage_inventory",
        name: "Track stock",
        header: "Track stock",
        field: (context) =>
          `variants.${context.row.original.originalIndex}.manage_inventory`,
        type: "boolean",
        cell: (context) => {
          return <DataGrid.BooleanCell context={context} />
        },
      }),
      ...(canHoldStock
        ? [
            columnHelper.column({
              id: "stock_quantity",
              name: "In stock",
              header: "In stock",
              field: (context) =>
                `variants.${context.row.original.originalIndex}.stock_quantity`,
              type: "number",
              cell: (context) => {
                return (
                  <DataGrid.NumberCell
                    min={0}
                    placeholder="0"
                    context={context}
                  />
                )
              },
            }),
          ]
        : []),

      ...createDataGridPriceColumns<VariantWithIndex, ProductCreateSchemaType>({
        currencies,
        pricePreferences,
        getFieldName: (context, value) => {
          if (context.column.id?.startsWith("currency_prices")) {
            return `variants.${context.row.original.originalIndex}.prices.${value}`
          }
          return `variants.${context.row.original.originalIndex}.prices.${value}`
        },
        t,
      }),
    ],
    [currencies, regions, options, pricePreferences, canHoldStock, t]
  )
}
