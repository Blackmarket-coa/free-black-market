import "@tanstack/react-table"
import type { HttpTypes } from "@medusajs/types"

declare module "@tanstack/react-table" {
  // Augment ColumnMeta so admin-panel tables can stash the API column
  // descriptor (used for hiding / labeling) alongside the column
  // definition. eslint-disable-next-line is for the unused TValue.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    name?: string
    column?: HttpTypes.AdminColumn
  }
}
