"use client"

import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/atoms"
import { useCartContext } from "@/components/providers"
import { addToCart } from "@/lib/data/cart"
import {
  getTicketSeatMap,
  type TicketDateAvailability,
  type TicketSeatMapRow,
} from "@/lib/data/tickets"
import { getPricesForVariant } from "@/lib/helpers/get-product-price"
import { toast } from "@/lib/helpers/toast"
import { cn } from "@/lib/utils"
import { HttpTypes } from "@medusajs/types"

type SelectedSeat = {
  variantId: string
  venueRowId: string
  rowNumber: string
  rowType: string
  seatNumber: string
}

// Fixed locale keeps server/client renders deterministic (no hydration drift).
const formatShowDate = (date: string) => {
  const parsed = new Date(date.includes("T") ? date : `${date}T00:00:00`)
  if (isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

// Seat identity is (venue row, seat number, show date). Keying on the variant
// (row type) instead would collide same-numbered seats across different rows of
// the same row type — falsely marking a free seat as already in the cart.
const seatKey = (venueRowId: string | null, seatNumber: string, date: string) =>
  `${venueRowId ?? ""}|${seatNumber}|${date}`

/**
 * Interactive buyer path for event tickets: pick a show date, pick a free
 * seat on the venue's seat map, add exactly one ticket per seat to the cart.
 * The line item is stamped with `{ venue_row_id, seat_number, show_date }`
 * metadata — the ticket completion flow (`placeTicketOrder`) needs it to
 * validate and record the seat purchase.
 */
export const TicketPurchasePanel = ({
  productId,
  productTitle,
  variants,
  locale,
  venueName,
  dates,
}: {
  productId: string
  productTitle: string
  variants: HttpTypes.StoreProductVariant[]
  locale: string
  venueName: string | null
  dates: TicketDateAvailability[]
}) => {
  const { cart } = useCartContext()

  const [selectedDate, setSelectedDate] = useState<string | null>(
    () => (dates.find((d) => !d.sold_out) || dates[0])?.date ?? null
  )
  const [seatMap, setSeatMap] = useState<TicketSeatMapRow[] | null>(null)
  const [loadingSeats, setLoadingSeats] = useState(true)
  const [seatMapError, setSeatMapError] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [selectedSeat, setSelectedSeat] = useState<SelectedSeat | null>(null)
  // Seats added during this visit — instant feedback while the server cart
  // revalidates in the background.
  const [addedKeys, setAddedKeys] = useState<Set<string>>(() => new Set())
  const [isAdding, setIsAdding] = useState(false)

  useEffect(() => {
    if (!selectedDate) return

    let cancelled = false
    setLoadingSeats(true)
    setSeatMapError(false)
    setSelectedSeat(null)

    getTicketSeatMap(productId, selectedDate).then((res) => {
      if (cancelled) return
      setSeatMap(res?.seat_map ?? null)
      setSeatMapError(!res)
      setLoadingSeats(false)
    })

    return () => {
      cancelled = true
    }
  }, [productId, selectedDate, reloadNonce])

  // Seats already in the cart (ticket line items carry seat metadata).
  const inCartKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const item of cart?.items || []) {
      const metadata = item.metadata as Record<string, unknown> | null
      if (metadata?.venue_row_id && metadata?.seat_number && metadata?.show_date) {
        keys.add(
          seatKey(
            String(metadata.venue_row_id),
            String(metadata.seat_number),
            String(metadata.show_date)
          )
        )
      }
    }
    return keys
  }, [cart])

  const isSeatInCart = (venueRowId: string | null, seatNumber: string) =>
    !!selectedDate &&
    (inCartKeys.has(seatKey(venueRowId, seatNumber, selectedDate)) ||
      addedKeys.has(seatKey(venueRowId, seatNumber, selectedDate)))

  // Same widening getProductPrice() applies internally: the storefront's
  // calculated_price carries tax fields the SDK type doesn't model.
  const priceForVariant = (variantId: string | null) =>
    getPricesForVariant(
      variants.find(({ id }) => id === variantId) as Parameters<
        typeof getPricesForVariant
      >[0]
    )?.calculated_price ?? null

  const selectedSeatPrice = selectedSeat
    ? priceForVariant(selectedSeat.variantId)
    : null

  const selectedDateAvailability = dates.find((d) => d.date === selectedDate)

  const handleAddTicket = async () => {
    if (!selectedSeat || !selectedDate) return

    setIsAdding(true)

    try {
      await addToCart({
        variantId: selectedSeat.variantId,
        // Tickets are strictly one per seat (enforced again at completion).
        quantity: 1,
        countryCode: locale,
        metadata: {
          venue_row_id: selectedSeat.venueRowId,
          seat_number: selectedSeat.seatNumber,
          show_date: selectedDate,
        },
      })
      setAddedKeys((prev) =>
        new Set(prev).add(
          seatKey(selectedSeat.venueRowId, selectedSeat.seatNumber, selectedDate)
        )
      )
      toast.success({
        title: "Ticket added to cart!",
        description: `${productTitle} — row ${selectedSeat.rowNumber}, seat ${selectedSeat.seatNumber}, ${formatShowDate(selectedDate)}`,
      })
      setSelectedSeat(null)
    } catch {
      toast.error({
        title: "Error adding ticket to cart",
        description: "The seat could not be added. Please try again.",
      })
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <div className="border rounded-sm p-5 my-4" data-testid="ticket-purchase-panel">
      <h2 className="heading-sm text-primary">
        Get tickets{venueName ? ` — ${venueName}` : ""}
      </h2>

      {/* Show date picker */}
      <p className="label-md text-secondary mt-3 mb-2">Choose a date</p>
      <div className="flex flex-wrap gap-2">
        {dates.map(({ date, sold_out }) => (
          <button
            key={date}
            onClick={() => setSelectedDate(date)}
            disabled={sold_out}
            aria-pressed={selectedDate === date}
            className={cn(
              "border rounded-sm px-3 py-2 text-sm transition-colors",
              selectedDate === date
                ? "bg-action text-action-on-primary border-action"
                : "hover:bg-action-secondary-hover",
              sold_out && "opacity-50 cursor-not-allowed line-through"
            )}
          >
            {formatShowDate(date)}
            {sold_out ? " (sold out)" : ""}
          </button>
        ))}
      </div>

      {/* Per-row-type availability for the chosen date */}
      {selectedDateAvailability && (
        <p className="text-sm text-secondary mt-2">
          {selectedDateAvailability.row_types
            .map(
              ({ row_type, available_seats }) =>
                `${row_type}: ${available_seats ?? 0} left`
            )
            .join(" · ")}
        </p>
      )}

      {/* Seat map */}
      <p className="label-md text-secondary mt-4 mb-2">Choose a seat</p>
      {loadingSeats ? (
        <div className="animate-pulse space-y-2" data-testid="seat-map-loading">
          <div className="h-8 bg-gray-200 rounded w-2/3" />
          <div className="h-8 bg-gray-200 rounded w-3/4" />
          <div className="h-8 bg-gray-200 rounded w-1/2" />
        </div>
      ) : seatMapError || !seatMap ? (
        <div className="text-sm text-secondary">
          Couldn&apos;t load the seat map.{" "}
          <button
            onClick={() => setReloadNonce((n) => n + 1)}
            className="underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-3 overflow-x-auto">
          {seatMap.map((row) => (
            <div key={row.venue_row_id}>
              <p className="text-sm text-primary mb-1">
                Row {row.row_number}{" "}
                <span className="text-secondary">
                  · {row.row_type}
                  {priceForVariant(row.seats[0]?.variant_id ?? null)
                    ? ` · ${priceForVariant(row.seats[0]?.variant_id ?? null)}`
                    : ""}
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {row.seats.map((seat) => {
                  const inCart = isSeatInCart(row.venue_row_id, seat.number)
                  const unavailable =
                    seat.is_purchased || inCart || !seat.variant_id
                  const isSelected =
                    !!selectedSeat &&
                    selectedSeat.venueRowId === row.venue_row_id &&
                    selectedSeat.seatNumber === seat.number

                  return (
                    <button
                      key={seat.number}
                      disabled={unavailable}
                      onClick={() =>
                        seat.variant_id &&
                        setSelectedSeat(
                          isSelected
                            ? null
                            : {
                                variantId: seat.variant_id,
                                venueRowId: row.venue_row_id,
                                rowNumber: row.row_number,
                                rowType: row.row_type,
                                seatNumber: seat.number,
                              }
                        )
                      }
                      aria-pressed={isSelected}
                      aria-label={`Row ${row.row_number}, seat ${seat.number}${
                        seat.is_purchased
                          ? " (taken)"
                          : inCart
                            ? " (in cart)"
                            : ""
                      }`}
                      title={
                        seat.is_purchased
                          ? "Taken"
                          : inCart
                            ? "In your cart"
                            : `Seat ${seat.number}`
                      }
                      className={cn(
                        "w-9 h-9 border rounded-sm text-xs transition-colors",
                        isSelected
                          ? "bg-action text-action-on-primary border-action"
                          : "hover:bg-action-secondary-hover",
                        unavailable &&
                          "bg-disabled text-disabled cursor-not-allowed hover:bg-disabled"
                      )}
                    >
                      {seat.number}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add ticket to cart */}
      <div className="mt-4">
        {selectedSeat && (
          <p className="text-sm text-primary mb-2" data-testid="selected-seat">
            Selected: row {selectedSeat.rowNumber}, seat{" "}
            {selectedSeat.seatNumber} ({selectedSeat.rowType})
            {selectedSeatPrice ? ` — ${selectedSeatPrice}` : ""}
          </p>
        )}
        <Button
          onClick={handleAddTicket}
          disabled={!selectedSeat || loadingSeats}
          loading={isAdding}
          className="w-full uppercase py-3 flex justify-center"
          size="large"
        >
          {selectedSeat ? "ADD TICKET TO CART" : "SELECT A SEAT"}
        </Button>
        <p className="text-sm text-secondary mt-2">
          One ticket per seat — add each seat you want separately.
        </p>
      </div>
    </div>
  )
}
