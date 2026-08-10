"use client"

import { SellerFooter, SellerHeading } from "@/components/organisms"
import { SellerScheduling } from "../SellerScheduling/SellerScheduling"
import { HttpTypes } from "@medusajs/types"
import DOMPurify from "dompurify"
import Link from "next/link"
import { useState, useEffect } from "react"

import { TrustIndicators } from "@/components/molecules/TrustIndicators/TrustIndicators"
import type { SellerTrust } from "@/lib/data/verification"

export const SellerPageHeader = ({
  header = false,
  seller,
  user,
  trust = null,
}: {
  header?: boolean
  seller: any
  user: HttpTypes.StoreCustomer | null
  /**
   * The seller's verification summary, fetched server-side. Null when the
   * lookup failed or the seller has no record yet — the strip is simply not
   * rendered, which is the behaviour this page had before badges existed.
   */
  trust?: SellerTrust | null
}) => {
  // State to store sanitized description
  const [sanitizedDescription, setSanitizedDescription] = useState(seller.description || "")

  // Sanitize on client side only to prevent hydration mismatch
  useEffect(() => {
    if (seller.description) {
      const cleaned = DOMPurify.sanitize(seller.description, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'span'],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'class']
      })
      setSanitizedDescription(cleaned)
    }
  }, [seller.description])

  return (
    <div className="border rounded-sm p-4">
      <SellerHeading header seller={seller} user={user} />
      <p
        dangerouslySetInnerHTML={{
          __html: sanitizedDescription,
        }}
        className="label-md my-5"
      />
      {trust && (
        <div className="my-5 border-t pt-4">
          <TrustIndicators
            verificationLevel={trust.level}
            trustScore={trust.trustScore}
            badges={trust.badges.map((badge) => badge.type)}
            yearsActive={trust.yearsActive}
            productionScale={trust.productionScale}
          />
          {trust.verificationStatement && (
            <p className="text-sm text-gray-600 mt-3">
              {trust.verificationStatement}
            </p>
          )}
          <Link
            href="/verification"
            className="text-sm text-green-700 underline mt-2 inline-block"
          >
            What do these mean?
          </Link>
        </div>
      )}
      <SellerScheduling seller={seller} />
      <SellerFooter seller={seller} />
    </div>
  )
}
