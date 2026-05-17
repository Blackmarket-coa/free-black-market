import { useWatch } from "react-hook-form"
import { useDataGridContext } from "@components/data-grid/context"

interface UseDataGridDuplicateCellOptions {
  duplicateOf: string
}

export const useDataGridDuplicateCell = ({
  duplicateOf,
}: UseDataGridDuplicateCellOptions) => {
  const { control } = useDataGridContext()

  const watchedValue = useWatch({ control, name: duplicateOf })

  return {
    watchedValue,
  }
}
