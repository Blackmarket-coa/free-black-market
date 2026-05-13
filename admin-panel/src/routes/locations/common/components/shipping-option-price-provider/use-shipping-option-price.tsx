import { useContext } from "react"
import { ShippingOptionPriceContext } from "@routes/locations/common/components/shipping-option-price-provider/shipping-option-price-context"

export const useShippingOptionPrice = () => {
  const context = useContext(ShippingOptionPriceContext)

  if (!context) {
    throw new Error(
      "useShippingOptionPrice must be used within a ShippingOptionPriceProvider"
    )
  }

  return context
}
