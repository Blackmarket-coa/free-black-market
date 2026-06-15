import { Input } from "@medusajs/ui"
import type { ChangeEvent} from "react";
import { useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"

import { debounce } from "lodash"
import { useSelectedParams } from "@components/table/data-table/hooks"

type DataTableSearchProps = {
  placeholder?: string
  prefix?: string
  autofocus?: boolean
}

export const DataTableSearch = ({
  placeholder,
  prefix,
  autofocus,
}: DataTableSearchProps) => {
  const { t } = useTranslation()
  const placeholderText = placeholder || t("general.search")
  const selectedParams = useSelectedParams({
    param: "q",
    prefix,
    multiple: false,
  })

  const query = selectedParams.get()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedOnChange = useCallback(
    debounce((e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value

      if (!value) {
        selectedParams.delete()
      } else {
        selectedParams.add(value)
      }
    }, 500),
    [selectedParams]
  )

  useEffect(() => {
    return () => {
      debouncedOnChange.cancel()
    }
  }, [debouncedOnChange])

  return (
    <Input
      autoComplete="off"
      name="q"
      type="search"
      size="small"
      // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional initial focus on this admin input
      autoFocus={autofocus}
      defaultValue={query?.[0] || undefined}
      onChange={debouncedOnChange}
      placeholder={placeholderText}
    />
  )
}
