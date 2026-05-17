import type { PropsWithChildren } from "react"

import { clx } from "@medusajs/ui"
import { useDataGridCellError } from "@components/data-grid/hooks"
import type { DataGridCellProps } from "@components/data-grid/types"
import { DataGridRowErrorIndicator } from "@components/data-grid/components/data-grid-row-error-indicator"

type DataGridReadonlyCellProps<TData, TValue = any> = PropsWithChildren<
  DataGridCellProps<TData, TValue>
> & {
  color?: "muted" | "normal"
}

export const DataGridReadonlyCell = <TData, TValue = any>({
  context,
  color = "muted",
  children,
}: DataGridReadonlyCellProps<TData, TValue>) => {
  const { rowErrors } = useDataGridCellError({ context })

  return (
    <div
      className={clx(
        "txt-compact-small text-ui-fg-subtle flex size-full cursor-not-allowed items-center justify-between overflow-hidden px-4 py-2.5 outline-none",
        color === "muted" && "bg-ui-bg-subtle",
        color === "normal" && "bg-ui-bg-base"
      )}
    >
      <div className="flex-1 truncate">{children}</div>
      <DataGridRowErrorIndicator rowErrors={rowErrors} />
    </div>
  )
}
