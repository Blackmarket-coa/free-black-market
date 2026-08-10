"use client"

import { SellerFooter, SellerHeading } from "@/components/organisms"
import { SellerScheduling } from "../SellerScheduling/SellerScheduling"
import { HttpTypes } from "@medusajs/types"
import DOMPurify from "dompurify"
import Link from "next/link"
import { useState, useEffect } from "react"

import { TrustIndicators } from "@/components/molecules/TrustIndicators/TrustIndicators"
import type { SellerStory, SellerTrust } from "@/lib/data/verification"

export const SellerPageHeader = ({
  header = false,
  seller,
  user,
  trust = null,
  story = null,
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
  /**
   * The seller's own account of themselves. Null when they haven't written one
   * — the section is omitted rather than rendered empty.
   */
  story?: SellerStory | null
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
      {story && hasStoryContent(story) && (
        <div className="my-5 border-t pt-4">
          <h2 className="heading-xs uppercase mb-2">Meet the maker</h2>
          {story.bio && (
            <p className="label-md whitespace-pre-line">{story.bio}</p>
          )}
          {story.region && (
            <p className="label-md text-secondary mt-2">Based in {story.region}</p>
          )}
          {[
            { label: "Practices", values: story.practices },
            { label: "Certifications", values: story.certifications },
            { label: "Focus", values: story.niches },
            { label: "Cuisine", values: story.cuisines },
          ]
            .filter((group) => group.values.length > 0)
            .map((group) => (
              <div key={group.label} className="mt-3">
                <p className="label-sm text-secondary uppercase mb-1">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.values.map((value) => (
                    <span
                      key={value}
                      className="label-sm border rounded-full px-2.5 py-0.5"
                    >
                      {value}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          {/*
            The seller's own claims, not ours. Certifications listed here are
            self-declared; the verified ones carry a badge in the trust strip
            below, which is a different assertion with a reviewer behind it.
          */}
          {story.certifications.length > 0 && (
            <p className="label-sm text-secondary mt-3">
              Listed by the seller. Certifications we have confirmed appear as
              badges below.
            </p>
          )}
        </div>
      )}
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

/** Whether a seller has written anything worth giving a section to. */
function hasStoryContent(story: SellerStory): boolean {
  return Boolean(
    story.bio ||
      story.region ||
      story.practices.length ||
      story.certifications.length ||
      story.niches.length ||
      story.cuisines.length
  )
}
