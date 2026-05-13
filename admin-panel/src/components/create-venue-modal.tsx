import type React from "react";
import { useState } from "react"
import { Button, FocusModal, Input, Label, Textarea, toast } from "@medusajs/ui"
import type { CreateVenueRequest} from "../types";
import { RowType } from "../types"

/**
 * Minimal "create venue" modal used by src/routes/venues/page.tsx. This
 * file was lost during a vendor-panel rebase and is reconstructed here
 * from the consumer's contract (open/onOpenChange/onSubmit). It is
 * intentionally a single-screen, single-row stub so the admin route
 * typechecks and renders; full seating-chart authoring should be reintroduced
 * as a follow-up.
 */
export interface CreateVenueModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: CreateVenueRequest) => Promise<void> | void
}

export const CreateVenueModal: React.FC<CreateVenueModalProps> = ({
  open,
  onOpenChange,
  onSubmit,
}) => {
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [seatCount, setSeatCount] = useState<string>("0")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const reset = () => {
    setName("")
    setAddress("")
    setSeatCount("0")
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Venue name is required")
      
return
    }
    const parsedSeats = Number.parseInt(seatCount, 10)
    if (!Number.isFinite(parsedSeats) || parsedSeats < 0) {
      toast.error("Seat count must be a non-negative integer")
      
return
    }
    setIsSubmitting(true)
    try {
      await onSubmit({
        name: name.trim(),
        address: address.trim() || undefined,
        rows:
          parsedSeats > 0
            ? [
                {
                  row_number: "A",
                  row_type: RowType.STANDARD,
                  seat_count: parsedSeats,
                },
              ]
            : [],
      })
      reset()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} isLoading={isSubmitting}>
              Create
            </Button>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-y-auto py-8">
          <div className="w-full max-w-lg space-y-6">
            <FocusModal.Title asChild>
              <h1 className="txt-large-plus">Create venue</h1>
            </FocusModal.Title>
            <div className="space-y-2">
              <Label htmlFor="venue-name">Name</Label>
              <Input
                id="venue-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Main Hall"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="venue-address">Address (optional)</Label>
              <Textarea
                id="venue-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Market St, Anytown"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="venue-seats">Initial seat count</Label>
              <Input
                id="venue-seats"
                type="number"
                inputMode="numeric"
                min={0}
                value={seatCount}
                onChange={(e) => setSeatCount(e.target.value)}
              />
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default CreateVenueModal
