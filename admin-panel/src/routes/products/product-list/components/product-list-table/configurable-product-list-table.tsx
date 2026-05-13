import type {
  DataTableRowSelectionState} from "@medusajs/ui";
import {
  createDataTableCommandHelper,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useState, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Outlet, useLocation } from "react-router-dom"

import { ConfigurableDataTable } from "@components/table/configurable-data-table"
import { useDeleteProducts } from "@hooks/api/products"
import { useProductTableAdapter } from "@routes/products/product-list/components/product-list-table/product-table-adapter"

const commandHelper = createDataTableCommandHelper()

export const ConfigurableProductListTable = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const adapter = useProductTableAdapter()
  const prompt = usePrompt()
  const [rowSelection, setRowSelection] =
    useState<DataTableRowSelectionState>({})
  const { mutateAsync: deleteProducts } = useDeleteProducts()

  const handleBulkDelete = useCallback(
    async (selection: Record<string, boolean>) => {
      const ids = Object.keys(selection)

      if (!ids.length) {
        return
      }

      const res = await prompt({
        title: t("general.areYouSure"),
        description: t("products.deleteWarningBatch", { count: ids.length }),
        confirmText: t("actions.delete"),
        cancelText: t("actions.cancel"),
      })

      if (!res) {
        return
      }

      await deleteProducts(
        { ids },
        {
          onSuccess: () => {
            toast.success(t("products.toasts.deleteBatch.success.header"), {
              description: t("products.toasts.deleteBatch.success.description", {
                count: ids.length,
              }),
            })
          },
          onError: (error) => {
            toast.error(t("products.toasts.deleteBatch.error.header"), {
              description: error.message,
            })
          },
        }
      )
    },
    [deleteProducts, prompt, t]
  )

  const commands = useMemo(
    () => [
      commandHelper.command({
        label: t("actions.delete"),
        shortcut: "d",
        action: handleBulkDelete,
      }),
    ],
    [handleBulkDelete, t]
  )

  return (
    <>
      <ConfigurableDataTable
        adapter={adapter}
        heading={t("products.domain")}
        actions={[
          { label: t("actions.export"), to: `export${location.search}` },
          { label: t("actions.import"), to: `import${location.search}` },
          { label: t("actions.create"), to: "create" },
        ]}
        commands={commands}
        rowSelection={{
          state: rowSelection,
          onRowSelectionChange: setRowSelection,
        }}
      />
      <Outlet />
    </>
  )
}
