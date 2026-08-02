"use client"

import { Accordion, FilterCheckboxOption } from "@/components/molecules"
import useFilters from "@/hooks/useFilters"

const vendorTypes = [
  { value: "producer", label: "Growers & Producers" },
  { value: "garden", label: "Community Growing Spaces" },
  { value: "kitchen", label: "Shared Kitchens" },
  { value: "maker", label: "Makers & Brands" },
  { value: "restaurant", label: "Food Businesses" },
  { value: "mutual_aid", label: "Community Organizations" },
  { value: "creator", label: "Creators" },
  { value: "general", label: "Businesses" },
]

export const VendorTypeFilter = () => {
  const { updateFilters, isFilterActive } = useFilters("vendor_type")

  return (
    <Accordion heading="Vendor Type">
      <ul className="px-4">
        {vendorTypes.map(({ value, label }) => (
          <li key={value} className="mb-4">
            <FilterCheckboxOption
              checked={isFilterActive(value)}
              onCheck={() => updateFilters(value)}
              label={label}
            />
          </li>
        ))}
      </ul>
    </Accordion>
  )
}
