"use client"
import { Button, Divider } from "@/components/atoms"
import { Modal, ReportSellerForm } from "@/components/molecules"
import { DoneIcon } from "@/icons"
import { SingleProductSeller } from "@/types/product"
import { SellerProps } from "@/types/seller"
import { format } from "date-fns"
import { useState } from "react"

export const SellerFooter = ({ seller }: { seller: SellerProps }) => {
  const [openModal, setOpenModal] = useState(false)
  // Sellers created through some admin flows have no created_at in the
  // store payload; date-fns throws on invalid input, which took down the
  // whole page. Render the join date only when it parses.
  const joinedDate = seller.created_at ? new Date(seller.created_at) : null
  const joinedLabel =
    joinedDate && !Number.isNaN(joinedDate.getTime())
      ? format(joinedDate, "yyyy-MM-dd")
      : null
  return (
    <div className="flex justify-between items-center flex-col lg:flex-row">
      <div className="flex gap-2 lg:gap-4 items-center label-sm lg:label-md text-secondary mb-4 lg:mb-0 justify-between w-full lg:justify-start lg:w-auto">
        {/* {seller.verified && (
          <div className="flex items-center gap-2">
            <DoneIcon size={20} />
            Verified provider
          </div>
        )} */}
        <Divider square />
        {joinedLabel && <p>Joined {joinedLabel}</p>}
        {/* <Divider square /> */}
        {/* <p>sold {seller.sold}</p> */}
      </div>
      <Button
        variant="text"
        size="large"
        className="uppercase"
        onClick={() => setOpenModal(true)}
      >
        Report
      </Button>
      {openModal && (
        <Modal heading="Report provider" onClose={() => setOpenModal(false)}>
          <ReportSellerForm onClose={() => setOpenModal(false)} />
        </Modal>
      )}
    </div>
  )
}
