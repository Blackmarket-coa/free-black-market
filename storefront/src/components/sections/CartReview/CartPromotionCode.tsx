"use client"
import { logger } from "@/lib/logger"
import { HttpTypes } from "@medusajs/types"
import { Button, Input } from "@/components/atoms"
import { Heading, Label } from "@medusajs/ui"
import { useState } from "react"
import { applyPromotions } from "@/lib/data/cart"
import { toast } from "@/lib/helpers/toast"

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
      const res = await applyPromotions([promotionCode])
      if (res) {
        toast.success({ title: "Promotion code applied" })
      } else {
        // The backend knows the code (an unknown one is refused, below) but
        // it took nothing off this cart, so Medusa did not keep it. A code
        // for shipping always lands here on this page: no delivery option is
        // chosen yet, and the code is not tried again once one is.
        toast.error({
          title: "This code doesn't apply to your cart",
          description: "It was not added. Check what the code is for, or try another one.",
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
