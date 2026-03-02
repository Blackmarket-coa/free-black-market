type OrderErrorLike = {
  message?: string
  code?: string
  type?: string
  error?: {
    code?: string
    type?: string
    message?: string
  }
}

const STOCK_ERROR_MESSAGES: Record<string, string> = {
  INVENTORY_OUT_OF_STOCK: "This item is currently out of stock.",
  INVENTORY_BACKORDER_REQUIRED: "This item is on backorder and will ship later.",
  INVENTORY_RESERVATION_CONFLICT:
    "Stock changed while you were checking out. Please review your cart and try again.",
}

export const orderErrorFormatter = (error: OrderErrorLike) => {
  if (error?.message === "NEXT_REDIRECT") {
    return null
  }

  const normalizedCode =
    error?.code ||
    error?.type ||
    error?.error?.code ||
    error?.error?.type ||
    ""

  if (normalizedCode && normalizedCode in STOCK_ERROR_MESSAGES) {
    return STOCK_ERROR_MESSAGES[normalizedCode]
  }

  if (error?.message?.includes("Not enough stock available")) {
    return "This item is currently out of stock."
  }

  return error?.message || error?.error?.message || "Something went wrong"
}
