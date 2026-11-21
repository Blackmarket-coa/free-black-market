/**
 * In place of a seller's list of options when none of them has a price to
 * show. Only calculated options can be in that state (a flat one carries its
 * amount): their prices are fetched after the page draws, and a fetch that
 * fails leaves the seller with nothing to choose. The step used to draw an
 * empty dropdown there, under "Choose a delivery option for …".
 */
export function UnpricedOptionsNotice({
  sellerName,
  settled,
}: {
  sellerName?: string | null
  /** The price requests have all come back. */
  settled: boolean
}) {
  return (
    <p
      className="p-3 bg-ui-bg-subtle rounded-lg text-sm text-ui-fg-subtle"
      role={settled ? "alert" : "status"}
      data-testid="delivery-prices-unavailable"
    >
      {settled
        ? `We couldn't load the delivery prices for ${sellerName || "this seller"}, so there is nothing to choose yet. Refresh the page to try again.`
        : "Loading delivery prices..."}
    </p>
  )
}
