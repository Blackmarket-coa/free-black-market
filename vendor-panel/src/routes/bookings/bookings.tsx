import { Badge, Button, Container, Heading, Input, Switch, Text, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"
import {
  AvailabilityWindow,
  useAvailability,
  useBookings,
  useSaveAvailability,
  useUpdateBookingStatus,
} from "../../hooks/api/booking"

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

type DayRow = { active: boolean; start: string; end: string }

const STATUS_COLORS: Record<string, "green" | "orange" | "red" | "grey"> = {
  confirmed: "green",
  pending: "orange",
  cancelled: "red",
  completed: "green",
  no_show: "grey",
}

/** Weekly availability editor — one window per day (covers the common case). */
const AvailabilityEditor = () => {
  const { availability, isPending } = useAvailability()
  const { mutate: save, isPending: saving } = useSaveAvailability()

  const [rows, setRows] = useState<DayRow[]>(
    DAYS.map(() => ({ active: false, start: "09:00", end: "17:00" }))
  )

  useEffect(() => {
    if (!availability.length) return
    const next: DayRow[] = DAYS.map(() => ({
      active: false,
      start: "09:00",
      end: "17:00",
    }))
    for (const w of availability) {
      if (w.day_of_week >= 0 && w.day_of_week < 7) {
        next[w.day_of_week] = {
          active: w.is_active !== false,
          start: w.start_time,
          end: w.end_time,
        }
      }
    }
    setRows(next)
  }, [availability])

  const update = (i: number, patch: Partial<DayRow>) => {
    setRows((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  const onSave = () => {
    const windows: AvailabilityWindow[] = rows
      .map((r, i) => ({ ...r, i }))
      .filter((r) => r.active)
      .map((r) => ({
        day_of_week: r.i,
        start_time: r.start,
        end_time: r.end,
        is_active: true,
      }))
    save(windows, {
      onSuccess: () => toast.success("Availability saved"),
      onError: () => toast.error("Could not save availability"),
    })
  }

  return (
    <div className="flex flex-col gap-y-3">
      {DAYS.map((day, i) => (
        <div key={day} className="flex items-center gap-3">
          <div className="flex w-32 items-center gap-2">
            <Switch
              checked={rows[i].active}
              onCheckedChange={(v) => update(i, { active: !!v })}
            />
            <Text size="small">{day}</Text>
          </div>
          <Input
            type="time"
            value={rows[i].start}
            disabled={!rows[i].active}
            onChange={(e) => update(i, { start: e.target.value })}
            className="w-32"
          />
          <Text size="small" className="text-ui-fg-muted">
            to
          </Text>
          <Input
            type="time"
            value={rows[i].end}
            disabled={!rows[i].active}
            onChange={(e) => update(i, { end: e.target.value })}
            className="w-32"
          />
        </div>
      ))}
      <div>
        <Button size="small" onClick={onSave} isLoading={saving || isPending} type="button">
          Save availability
        </Button>
      </div>
      <Text size="xsmall" className="text-ui-fg-muted">
        Times are in your booking timezone (set per-product). Customers see slots
        converted to their own local time.
      </Text>
    </div>
  )
}

/** Upcoming bookings with confirm / cancel actions. */
const BookingsList = () => {
  const { bookings, isPending } = useBookings()
  const { mutate: setStatus } = useUpdateBookingStatus()

  const act = (id: string, status: string) => {
    setStatus(
      { id, status },
      {
        onSuccess: () => toast.success(`Booking ${status}`),
        onError: () => toast.error("Could not update booking"),
      }
    )
  }

  if (isPending) {
    return <Text size="small" className="text-ui-fg-muted">Loading…</Text>
  }
  if (!bookings.length) {
    return <Text size="small" className="text-ui-fg-muted">No bookings yet.</Text>
  }

  return (
    <div className="border-ui-border-base divide-ui-border-base divide-y rounded-lg border">
      {bookings.map((b) => (
        <div key={b.id} className="flex items-center justify-between gap-3 p-3">
          <div className="flex flex-col gap-0.5">
            <Text size="small" className="font-medium">
              {new Date(b.starts_at).toLocaleString()}
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              {b.customer_name ? `${b.customer_name} · ` : ""}
              {b.customer_email}
            </Text>
          </div>
          <div className="flex items-center gap-2">
            <Badge size="2xsmall" color={STATUS_COLORS[b.status] || "grey"}>
              {b.status}
            </Badge>
            {b.status === "pending" && (
              <>
                <Button size="small" variant="secondary" onClick={() => act(b.id, "confirmed")} type="button">
                  Confirm
                </Button>
                <Button size="small" variant="transparent" onClick={() => act(b.id, "cancelled")} type="button">
                  Decline
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export const Bookings = () => {
  return (
    <Container className="p-0">
      <div className="px-6 py-4">
        <Heading>Bookings</Heading>
        <Text className="text-ui-fg-subtle mt-1" size="small">
          Set your weekly availability and manage appointment requests from your
          embedded booking widget.
        </Text>
      </div>
      <div className="flex flex-col gap-y-8 px-6 pb-6">
        <div>
          <Heading level="h2" className="mb-3">Weekly availability</Heading>
          <AvailabilityEditor />
        </div>
        <div>
          <Heading level="h2" className="mb-3">Upcoming bookings</Heading>
          <BookingsList />
        </div>
      </div>
    </Container>
  )
}

export const Component = Bookings
