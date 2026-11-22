"use client"
import { logger } from "@/lib/logger"
import { HttpTypes } from "@medusajs/types"
import { Button, Input } from "@/components/atoms"
import { Heading, Label } from "@medusajs/ui"
import { useState } from "react"
import { addPromotionCode } from "@/lib/data/cart"
import { listNames } from "@/lib/helpers/seller-shipping"
import { toast } from "@/lib/helpers/toast"

/** An earlier code Medusa dropped in the same update: said, never left for the buyer to find out. */
const removedNote = (removed: string[]) =>
  removed.length
    ? `${listNames(removed)} no longer ${removed.length === 1 ? "applies" : "apply"} to your cart and ${
        removed.length === 1 ? "was" : "were"
      } removed.`
    : ""

export default function CartPromotionCode({
  cart,
}: {
  cart: HttpTypes.StoreCart | null
}) {
  const [promotionCode, setPromotionCode] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleApplyPromotionCode = async () => {
    setIsLoading(true)
    try {
      // Added to the codes the cart has, not in their place (lib/data/cart.ts).
      const res = await addPromotionCode(promotionCode)
      const removed = removedNote(res.removed)
      if (res.applied) {
        toast.success({
          title: "Promotion code applied",
          ...(removed ? { description: removed } : {}),
        })
      } else {
        // The backend knows the code (an unknown one is refused, below) but
        // it took nothing off this cart, so Medusa did not keep it. A code
        // for shipping always lands here on this page: no delivery option is
        // chosen yet, and the code is not tried again once one is.
        toast.error({
          title: "This code doesn't apply to your cart",
          description: `It was not added. ${
            removed ||
            (res.kept.length
              ? "Your other codes still apply."
              : "Check what the code is for, or try another one.")
          }`,
        })
      }
      setPromotionCode("")
    } catch (err) {
      // An unknown code ("The promotion code … is invalid"), or the request
      // failed. Said to the buyer: this used to go to the log only.
      logger.info(err)
      toast.error({
        title: "We couldn't apply that code",
        description: "Check the code and try again.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div>
      <Heading
        level="h2"
        className="flex flex-row text-3xl-regular gap-x-2 items-baseline items-center"
      >
        Promotion codes
      </Heading>
      <div>
        {cart?.promotions?.map((promo) => (
          <div
            key={promo.id}
            className="mb-4 flex flex-row gap-x-2 items-center"
          >
            <Label className="text-md">{promo.code}</Label>
          </div>
        ))}
      </div>
      <Input
        placeholder="Enter your promotion code"
        value={promotionCode}
        onChange={(e) => setPromotionCode(e.target.value)}
      />
      <div className="flex justify-end">
        <Button
          className="mt-4 px-6"
          onClick={handleApplyPromotionCode}
          disabled={isLoading || !promotionCode}
          loading={isLoading}
          variant="tonal"
        >
          Use promotion code
        </Button>
      </div>
    </div>
  )
}
